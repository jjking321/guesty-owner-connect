import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  listingId: string,
  limit: number,
  skip: number
) {
  const url = new URL('https://open-api.guesty.com/v1/reviews');
  url.searchParams.append('listingId', listingId);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('skip', skip.toString());

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
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
        const backoffMs = 2000 * Math.pow(2, attempt);
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
  resumeFromOffset: number
) {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log(`Starting review sync for account: ${guestyAccountId}, resuming from offset: ${resumeFromOffset}`);

    const { data: guestyAccount, error: accountError } = await supabaseClient
      .from('guesty_accounts')
      .select('client_id, client_secret, last_reviews_sync')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !guestyAccount) {
      throw new Error('Guesty account not found');
    }

    // Use cached token manager
    const accessToken = await getGuestyAccessTokenCached(
      supabaseClient,
      guestyAccountId,
      guestyAccount.client_id,
      guestyAccount.client_secret
    );

    const { data: listings, error: listingsError } = await supabaseClient
      .from('listings')
      .select('id')
      .eq('guesty_account_id', guestyAccountId)
      .eq('archived', false)
      .eq('active', true);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    if (!listings || listings.length === 0) {
      console.log('No active listings found for this account');
      await supabaseClient
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_synced: 0,
          progress_message: 'No active listings to sync reviews for',
        })
        .eq('id', syncJobId);
      return;
    }

    const totalListings = listings.length;
    console.log(`Found ${totalListings} active listings to sync reviews for`);

    await supabaseClient
      .from('sync_jobs')
      .update({
        total_items: totalListings,
        progress_message: `Starting sync for ${totalListings} listings...`,
      })
      .eq('id', syncJobId);

    let totalReviewsSynced = 0;
    let listingsProcessed = 0;

    for (const listing of listings) {
      listingsProcessed++;
      const listingId = listing.id;
      
      console.log(`Processing listing ${listingsProcessed}/${totalListings}: ${listingId}`);

      let listingReviewsCount = 0;
      let currentOffset = 0;
      let hasMorePages = true;

      while (hasMorePages) {
        console.log(`Fetching reviews for listing ${listingId} (offset: ${currentOffset})`);

        const reviewsData = await fetchReviewsPage(
          accessToken,
          listingId,
          REVIEWS_BATCH_SIZE,
          currentOffset
        );

        const results = reviewsData.results || [];
        console.log(`Received ${results.length} reviews for listing ${listingId}`);

        if (results.length === 0) {
          hasMorePages = false;
          break;
        }

        const reviewsToInsert = results.map((review: any) => ({
          id: review._id || review.id,
          guesty_account_id: guestyAccountId,
          listing_id: review.listingId,
          reservation_id: review.reservationId || null,
          guest_name: review.guestName || null,
          rating: typeof review.rating === 'number' ? review.rating : (review.rating ? parseFloat(review.rating) : null),
          review_text: review.review || null,
          response_text: review.publicReply || null,
          review_date: review.createdAt || null,
          source: review.source || null,
          category_ratings: review.categories || null,
        }));

        const { error: upsertError } = await supabaseClient
          .from('reviews')
          .upsert(reviewsToInsert, { onConflict: 'id' });

        if (upsertError) {
          console.error('Error upserting reviews:', upsertError);
          throw upsertError;
        }

        listingReviewsCount += results.length;
        totalReviewsSynced += results.length;
        currentOffset += results.length;

        if (results.length < REVIEWS_BATCH_SIZE) {
          hasMorePages = false;
        }

        if (hasMorePages) {
          await delay(REQUEST_DELAY_MS);
        }
      }

      console.log(`Completed listing ${listingId}: ${listingReviewsCount} reviews`);

      await supabaseClient
        .from('sync_jobs')
        .update({
          items_synced: listingsProcessed,
          progress_message: `Syncing reviews for listing ${listingsProcessed} of ${totalListings} (${totalReviewsSynced} reviews total)`,
        })
        .eq('id', syncJobId);

      if (listingsProcessed < totalListings) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    await supabaseClient
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_synced: totalListings,
        progress_message: `Successfully synced ${totalReviewsSynced} reviews from ${totalListings} listings`,
      })
      .eq('id', syncJobId);

    await supabaseClient
      .from('guesty_accounts')
      .update({ last_reviews_sync: new Date().toISOString() })
      .eq('id', guestyAccountId);

    console.log(`Review sync completed successfully: ${totalReviewsSynced} reviews synced from ${totalListings} listings`);
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

    const { data: existingJob } = await supabaseAdmin
      .from('sync_jobs')
      .select('*')
      .eq('guesty_account_id', guestyAccountId)
      .eq('sync_type', 'reviews')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let syncJob;
    let resumeFromOffset = 0;

    if (existingJob) {
      syncJob = existingJob;
      resumeFromOffset = existingJob.last_synced_offset || 0;
      console.log(`Resuming existing sync job: ${syncJob.id} from offset ${resumeFromOffset}`);
    } else {
      const { data: newJob, error: jobError } = await supabaseAdmin
        .from('sync_jobs')
        .insert({
          guesty_account_id: guestyAccountId,
          sync_type: 'reviews',
          status: 'running',
          items_synced: 0,
          last_synced_offset: 0,
          progress_message: 'Starting review sync...',
        })
        .select()
        .single();

      if (jobError || !newJob) {
        console.error('Failed to create sync job:', jobError);
        throw new Error(`Failed to create sync job: ${jobError?.message || 'Unknown error'}`);
      }

      syncJob = newJob;
      console.log(`Created new sync job: ${syncJob.id}`);
    }

    EdgeRuntime.waitUntil(
      performSync(guestyAccountId, syncJob.id, resumeFromOffset)
    );

    return new Response(
      JSON.stringify({
        started: true,
        jobId: syncJob.id,
        resumed: !!existingJob,
        message: existingJob 
          ? `Resuming review sync from ${resumeFromOffset} reviews`
          : 'Review sync started in background',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in sync-reviews function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
