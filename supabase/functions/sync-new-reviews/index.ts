import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REVIEWS_BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 500;
const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000;
const TOKEN_BUFFER_MS = 120000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 1000;
const LOCK_MAX_POLLS = 6;

// Format Guesty channel IDs to human-readable platform names
function formatChannelId(channelId: string | null): string {
  if (!channelId) return 'Unknown';
  const channelMap: Record<string, string> = {
    'airbnb': 'Airbnb',
    'airbnb2': 'Airbnb',
    'vrbo': 'VRBO',
    'homeaway': 'VRBO',
    'homeaway2': 'VRBO',
    'booking': 'Booking.com',
    'bookingcom': 'Booking.com',
    'manual': 'Direct',
  };
  return channelMap[channelId.toLowerCase()] || channelId;
}

// Helper to safely extract string from potentially nested objects (VRBO uses { text: "..." })
function extractStringValue(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    // Try common nested text field names
    return value.text || value.value || value.body || 
           value.content || value.message || null;
  }
  return null;
}

// Extract review text from platform-specific field locations
function extractReviewText(rawReview: any, channelId: string): string | null {
  if (!rawReview) return null;
  
  const channel = (channelId || '').toLowerCase();
  
  // Airbnb: use public_review directly
  if (channel === 'airbnb' || channel === 'airbnb2') {
    return extractStringValue(rawReview.public_review);
  }
  
  // Booking.com: content is nested under rawReview.content
  if (channel === 'booking' || channel === 'bookingcom') {
    const content = rawReview.content || rawReview;
    const parts: string[] = [];
    
    const headline = extractStringValue(content.headline);
    const positive = extractStringValue(content.positive) || 
                     extractStringValue(content.pros) ||
                     extractStringValue(content.positive_guest_comment) ||
                     extractStringValue(content.liked);
    const negative = extractStringValue(content.negative) || 
                     extractStringValue(content.cons) ||
                     extractStringValue(content.negative_guest_comment) ||
                     extractStringValue(content.disliked);
    
    if (headline) parts.push(headline);
    if (positive) parts.push(`Positive: ${positive}`);
    if (negative) parts.push(`Negative: ${negative}`);
    
    if (parts.length > 0) return parts.join('\n\n');
    
    // Fallback to combined comment fields
    return extractStringValue(content.guest_comment) || 
           extractStringValue(content.comment) || 
           extractStringValue(content.text) ||
           extractStringValue(content.body) || null;
  }
  
  // VRBO/HomeAway: fields may be objects with nested text
  if (channel === 'vrbo' || channel === 'homeaway' || channel === 'homeaway2') {
    const headline = extractStringValue(rawReview.headline) || 
                     extractStringValue(rawReview.title);
    const body = extractStringValue(rawReview.body) || 
                 extractStringValue(rawReview.text) || 
                 extractStringValue(rawReview.reviewText) ||
                 extractStringValue(rawReview.guestReview) ||
                 extractStringValue(rawReview.review_body) ||
                 extractStringValue(rawReview.bodyText);
    
    if (headline && body) return `${headline}\n\n${body}`;
    return body || headline || null;
  }
  
  // Fallback: try common field names
  return extractStringValue(rawReview.public_review) || 
         extractStringValue(rawReview.body) || 
         extractStringValue(rawReview.text) || 
         extractStringValue(rawReview.comment) || 
         extractStringValue(rawReview.review_text) || null;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = new Date(header).getTime();
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return 0;
}

async function getGuestyAccessTokenCached(
  supabaseAdmin: any,
  accountId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const { data: tokenRow, error: readError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .select('*')
    .eq('guesty_account_id', accountId)
    .maybeSingle();

  if (readError) {
    console.error('Error reading token cache:', readError);
  }

  if (tokenRow) {
    if (tokenRow.oauth_cooldown_until) {
      const cooldownUntil = new Date(tokenRow.oauth_cooldown_until).getTime();
      if (cooldownUntil > Date.now()) {
        const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
        throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
      }
    }

    const expiresAt = new Date(tokenRow.expires_at).getTime();
    if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      console.log('token_cache_hit: Using cached access token');
      return tokenRow.access_token;
    }
  }

  console.log('token_cache_miss_refreshing: Token expired or not found, refreshing...');

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS).toISOString();

  const { data: lockResult, error: lockError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .update({
      refresh_in_progress: true,
      refresh_started_at: now,
      updated_at: now,
    })
    .eq('guesty_account_id', accountId)
    .or(`refresh_in_progress.eq.false,refresh_started_at.lt.${staleThreshold}`)
    .select();

  const lockAcquired = !lockError && lockResult && lockResult.length > 0;

  if (!lockAcquired && tokenRow) {
    console.log('token_refresh_lock_wait: Another process is refreshing, waiting...');
    
    for (let poll = 0; poll < LOCK_MAX_POLLS; poll++) {
      await delay(LOCK_POLL_INTERVAL_MS);
      
      const { data: polledToken } = await supabaseAdmin
        .from('guesty_oauth_tokens')
        .select('access_token, expires_at, refresh_in_progress, oauth_cooldown_until')
        .eq('guesty_account_id', accountId)
        .maybeSingle();

      if (polledToken) {
        if (polledToken.oauth_cooldown_until) {
          const cooldownUntil = new Date(polledToken.oauth_cooldown_until).getTime();
          if (cooldownUntil > Date.now()) {
            const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
            throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
          }
        }

        if (!polledToken.refresh_in_progress) {
          const expiresAt = new Date(polledToken.expires_at).getTime();
          if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
            console.log('token_cache_hit_after_wait: Got token after waiting for refresh');
            return polledToken.access_token;
          }
        }
      }
    }

    console.log('token_refresh_lock_retry: Retrying lock acquisition after wait');
  }

  console.log('token_refresh_lock_acquired: Acquired lock, fetching new token');

  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    
    const { error: upsertError } = await supabaseAdmin
      .from('guesty_oauth_tokens')
      .upsert({
        guesty_account_id: accountId,
        access_token: token,
        expires_at: expiresAt,
        oauth_cooldown_until: null,
        refresh_in_progress: false,
        refresh_started_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'guesty_account_id' });

    if (upsertError) {
      console.error('Error saving token to cache:', upsertError);
    }

    console.log('token_refresh_success: New token cached');
    return token;
  } catch (error: any) {
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      const cooldownMinutes = 3;
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000).toISOString();
      
      await supabaseAdmin
        .from('guesty_oauth_tokens')
        .upsert({
          guesty_account_id: accountId,
          access_token: tokenRow?.access_token || '',
          expires_at: tokenRow?.expires_at || new Date().toISOString(),
          oauth_cooldown_until: cooldownUntil,
          refresh_in_progress: false,
          refresh_started_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'guesty_account_id' });
    } else {
      await supabaseAdmin
        .from('guesty_oauth_tokens')
        .update({
          refresh_in_progress: false,
          refresh_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('guesty_account_id', accountId);
    }
    
    throw error;
  }
}

async function fetchGuestyOAuthToken(clientId: string, clientSecret: string): Promise<string> {
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Token fetch attempt ${attempt}/${MAX_RETRIES}`);
      
      const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'open-api',
        }),
      });

      if (tokenResponse.status === 429) {
        const retryAfterMs = parseRetryAfter(tokenResponse.headers.get('retry-after'));
        const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        const waitTime = Math.max(backoff, retryAfterMs || 0);
        
        if (Date.now() - start + waitTime > MAX_WAIT_TIME) {
          const estimatedWaitMinutes = Math.max(3, Math.ceil(retryAfterMs / 60000));
          throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${estimatedWaitMinutes} minutes before trying again.`);
        }

        console.log(`Rate limited on token request. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        continue;
      }

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to get access token: ${tokenResponse.status} - ${errorText}`);
      }

      const { access_token } = await tokenResponse.json();
      console.log('Successfully obtained access token');
      return access_token;
    } catch (error: any) {
      if (error.message?.includes('OAUTH_RATE_LIMIT')) {
        throw error;
      }
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      console.log(`Error on attempt ${attempt}, retrying...`, error.message);
      await delay(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }
  
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3 minutes.');
}

async function fetchReviewsPage(
  accessToken: string,
  limit: number,
  skip: number,
  startDate: string,
  endDate: string
) {
  const url = new URL('https://open-api.guesty.com/v1/reviews');
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('skip', skip.toString());
  url.searchParams.append('startDate', startDate);
  url.searchParams.append('endDate', endDate);

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`Fetching reviews: skip=${skip}, limit=${limit}, startDate=${startDate}, endDate=${endDate}`);
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      const rateLimitSecond = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMinute = response.headers.get('X-ratelimit-remaining-minute');
      const rateLimitHour = response.headers.get('X-ratelimit-remaining-hour');
      
      if (rateLimitSecond || rateLimitMinute || rateLimitHour) {
        console.log(`Rate limits - Second: ${rateLimitSecond}/15, Minute: ${rateLimitMinute}/120, Hour: ${rateLimitHour}/5000`);
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        const backoffMs = Math.max(2000 * Math.pow(2, attempt), retryAfterMs || 0);
        console.log(`Rate limited (429), retrying after ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoffMs);
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Guesty API error: ${response.status} ${response.statusText} - ${bodyText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await delay(backoffMs);
      }
    }
  }

  throw lastError || new Error('Failed to fetch reviews after retries');
}

async function performSync(
  guestyAccountId: string,
  syncJobId: string,
  startDate: string
) {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log(`Starting incremental review sync for account: ${guestyAccountId}, from ${startDate}`);

    const { data: guestyAccount, error: accountError } = await supabaseClient
      .from('guesty_accounts')
      .select('client_id, client_secret')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !guestyAccount) {
      throw new Error('Guesty account not found');
    }

    // Get access token using cached token manager
    const accessToken = await getGuestyAccessTokenCached(
      supabaseClient,
      guestyAccountId,
      guestyAccount.client_id,
      guestyAccount.client_secret
    );

    // Get list of this account's listing IDs for filtering
    const { data: accountListings, error: listingsError } = await supabaseClient
      .from('listings')
      .select('id')
      .eq('guesty_account_id', guestyAccountId);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    const accountListingIds = new Set(accountListings?.map(l => l.id) || []);
    console.log(`Found ${accountListingIds.size} listings for this account`);

    // Calculate date range - from startDate to now
    const endDate = new Date().toISOString();
    
    console.log(`Fetching reviews from ${startDate} to ${endDate}`);

    await supabaseClient
      .from('sync_jobs')
      .update({
        progress_message: `Fetching new reviews since last sync...`,
      })
      .eq('id', syncJobId);

    let totalReviewsSynced = 0;
    let totalReviewsFiltered = 0;
    let currentOffset = 0;
    let hasMore = true;
    let pageNumber = 0;

    while (hasMore) {
      pageNumber++;
      console.log(`Fetching page ${pageNumber} (offset: ${currentOffset})`);

      const reviewsData = await fetchReviewsPage(
        accessToken,
        REVIEWS_BATCH_SIZE,
        currentOffset,
        startDate,
        endDate
      );

      const results = reviewsData.data || [];
      console.log(`Received ${results.length} reviews from API`);

      if (results.length === 0) {
        hasMore = false;
        break;
      }

      // Filter to only reviews for this account's listings
      const validReviews = results.filter((review: any) => 
        accountListingIds.has(review.listingId)
      );
      
      console.log(`Filtered to ${validReviews.length} reviews for this account's listings`);
      totalReviewsFiltered += (results.length - validReviews.length);

      if (validReviews.length > 0) {
        // Collect reservation IDs to look up guest names
        const reservationIds = validReviews
          .map((r: any) => r.reservationId)
          .filter((id: any) => id != null);

        // Fetch guest names from reservations table
        let guestNameMap = new Map<string, string>();
        if (reservationIds.length > 0) {
          const { data: reservations } = await supabaseClient
            .from('reservations')
            .select('id, guest_name')
            .in('id', reservationIds);

          if (reservations) {
            guestNameMap = new Map(
              reservations.map((r: any) => [r.id, r.guest_name])
            );
          }
          console.log(`Fetched guest names for ${guestNameMap.size} reservations`);
        }

        const reviewsToInsert = validReviews.map((review: any) => {
          const rawReview = review.rawReview || {};
          const reviewer = rawReview.reviewer || {};
          
          // Extract rating from multiple possible fields
          let rating: number | null = null;
          
          // Airbnb/VRBO: overall_rating or starRatingOverall (1-5 scale)
          if (typeof rawReview.overall_rating === 'number') {
            rating = rawReview.overall_rating;
          } else if (rawReview.starRatingOverall) {
            rating = parseFloat(rawReview.starRatingOverall);
          }
          
          // Booking.com: score or average_score (10-point scale) - normalize to 5
          if (rating === null) {
            const bookingScore = rawReview.score ?? rawReview.average_score ?? rawReview.overall_score ?? rawReview.total_score;
            if (typeof bookingScore === 'number') {
              // Normalize 10-point scale to 5-star scale
              rating = bookingScore / 2;
            }
          }
          
          // Also check top-level score field (some channel integrations)
          if (rating === null && typeof review.score === 'number') {
            if (review.score > 5) {
              rating = review.score / 2; // Normalize 10-point to 5-star
            } else {
              rating = review.score;
            }
          }
          
          // Booking.com: check scoring object (nested structure)
          if (rating === null && rawReview.scoring) {
            const scoring = rawReview.scoring;
            // Booking.com scoring can be: scoring.review_score, scoring.total, scoring.rating, or just a number
            const scoringValue = typeof scoring === 'number' 
              ? scoring 
              : (scoring.review_score ?? scoring.total ?? scoring.rating ?? scoring.score ?? scoring.average);
            
            if (typeof scoringValue === 'number') {
              // Normalize 10-point scale to 5-star scale
              rating = scoringValue > 5 ? scoringValue / 2 : scoringValue;
            } else if (typeof scoringValue === 'string') {
              const parsed = parseFloat(scoringValue);
              if (!isNaN(parsed)) {
                rating = parsed > 5 ? parsed / 2 : parsed;
              }
            }
          }
          
          // Log review structure when rating is null (for debugging)
          if (rating === null) {
            console.log(`No rating found for ${formatChannelId(review.channelId)} review:`, {
              reviewId: review._id,
              channelId: review.channelId,
              rawReviewKeys: Object.keys(rawReview),
              topLevelKeys: Object.keys(review),
              scoringValue: rawReview.scoring ? JSON.stringify(rawReview.scoring) : null,
            });
          }

          // Get guest name from reservation lookup, fallback to reviewer info
          const guestName = guestNameMap.get(review.reservationId) 
            || reviewer.name 
            || reviewer.first_name 
            || null;

          // Convert category_ratings array to object if needed
          let categoryRatings = null;
          if (Array.isArray(rawReview.category_ratings)) {
            categoryRatings = rawReview.category_ratings.reduce((acc: any, cat: any) => {
              if (cat.category && cat.rating != null) {
                acc[cat.category] = cat.rating;
              }
              return acc;
            }, {});
          } else if (rawReview.category_ratings) {
            categoryRatings = rawReview.category_ratings;
          }
          
          // Extract review text using platform-specific logic
          const reviewText = extractReviewText(rawReview, review.channelId);
          
          // Debug logging when review text is null for non-Airbnb platforms
          if (!reviewText && Object.keys(rawReview).length > 0) {
            const channel = (review.channelId || '').toLowerCase();
            if (channel !== 'airbnb' && channel !== 'airbnb2') {
              console.log(`No review text found for ${formatChannelId(review.channelId)}:`, {
                reviewId: review._id,
                rawReviewKeys: Object.keys(rawReview),
              });
            }
          }

          return {
            id: review._id,
            guesty_account_id: guestyAccountId,
            listing_id: review.listingId,
            reservation_id: review.reservationId || null,
            guest_name: guestName,
            rating: rating,
            review_text: reviewText,
            response_text: rawReview.private_feedback || null,
            review_date: review.createdAt || null,
            source: formatChannelId(review.channelId),
            category_ratings: categoryRatings,
          };
        });

        const { error: upsertError } = await supabaseClient
          .from('reviews')
          .upsert(reviewsToInsert, { onConflict: 'id' });

        if (upsertError) {
          console.error('Error upserting reviews:', upsertError);
          throw upsertError;
        }

        totalReviewsSynced += validReviews.length;
      }

      currentOffset += results.length;

      // Update progress
      await supabaseClient
        .from('sync_jobs')
        .update({
          items_synced: totalReviewsSynced,
          last_synced_offset: currentOffset,
          progress_message: `Synced ${totalReviewsSynced} new reviews (page ${pageNumber})...`,
        })
        .eq('id', syncJobId);

      if (results.length < REVIEWS_BATCH_SIZE) {
        hasMore = false;
      }

      // Rate limit delay between pages
      if (hasMore) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    await supabaseClient
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_synced: totalReviewsSynced,
        progress_message: `Successfully synced ${totalReviewsSynced} new reviews`,
      })
      .eq('id', syncJobId);

    await supabaseClient
      .from('guesty_accounts')
      .update({ last_reviews_sync: new Date().toISOString() })
      .eq('id', guestyAccountId);

    console.log(`Incremental review sync completed: ${totalReviewsSynced} reviews synced, ${totalReviewsFiltered} filtered out (other accounts)`);
  } catch (error) {
    console.error('Review sync failed:', error);
    
    await supabaseClient
      .from('sync_jobs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', syncJobId);

    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { guestyAccountId } = await req.json();

    if (!guestyAccountId) {
      return new Response(
        JSON.stringify({ error: 'guestyAccountId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the most recent review imported_at for this account
    const { data: latestReview, error: reviewError } = await supabaseAdmin
      .from('reviews')
      .select('imported_at')
      .eq('guesty_account_id', guestyAccountId)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reviewError) {
      console.error('Error fetching latest review:', reviewError);
      return new Response(
        JSON.stringify({ error: 'Failed to check existing reviews' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!latestReview) {
      return new Response(
        JSON.stringify({ 
          error: 'No existing reviews found. Please run a full review sync from Settings first.',
          requiresFullSync: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use imported_at as the start date for incremental sync
    const startDate = latestReview.imported_at;
    console.log(`Starting incremental sync from: ${startDate}`);

    const { data: newJob, error: jobError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({
        guesty_account_id: guestyAccountId,
        sync_type: 'new_reviews',
        status: 'running',
        items_synced: 0,
        last_synced_offset: 0,
        progress_message: 'Starting incremental review sync...',
      })
      .select()
      .single();

    if (jobError || !newJob) {
      console.error('Failed to create sync job:', jobError);
      throw new Error(`Failed to create sync job: ${jobError?.message || 'Unknown error'}`);
    }

    console.log(`Created new sync job: ${newJob.id}`);

    EdgeRuntime.waitUntil(
      performSync(guestyAccountId, newJob.id, startDate)
    );

    return new Response(
      JSON.stringify({
        started: true,
        jobId: newJob.id,
        startDate,
        message: 'Incremental review sync started',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in sync-new-reviews function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
