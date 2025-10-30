import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REVIEWS_BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 500; // Delay between API calls to avoid rate limits
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE_MS = 2000;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGuestyAccessToken(clientId: string, clientSecret: string, retries = 5): Promise<string> {
  let lastError: Error | null = null;
  const MAX_WAIT_TIME = 45000; // 45 seconds max wait (edge functions timeout at 60s)
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.log(`Token retry attempt ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await delay(backoffDelay);
      } else {
        console.log('Exchanging client credentials for access token...');
      }
      
      const response = await fetch('https://open-api.guesty.com/oauth2/token', {
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
        }).toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        
        // Check if it's a rate limit error (429) and we have retries left
        if (response.status === 429 && attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          let waitTime: number;
          
          if (retryAfter) {
            const retryAfterNum = parseInt(retryAfter);
            if (!isNaN(retryAfterNum)) {
              waitTime = retryAfterNum * 1000;
              
              // Check if wait time is too long
              if (waitTime > MAX_WAIT_TIME) {
                const hoursToWait = Math.round(waitTime / 3600000);
                console.error(`Rate limit requires waiting ${retryAfterNum}s (~${hoursToWait}h). Too long - failing.`);
                throw new Error(`Guesty API rate limit: Please try again in ${hoursToWait} hour(s). Guesty has temporarily limited access to their API.`);
              }
              
              console.log(`Token endpoint rate limited. Retry-After header: ${retryAfterNum}s (${waitTime}ms)`);
            } else {
              const retryDate = new Date(retryAfter);
              waitTime = retryDate.getTime() - Date.now();
              
              if (waitTime > MAX_WAIT_TIME) {
                const hoursToWait = Math.round(waitTime / 3600000);
                console.error(`Rate limit until ${retryAfter}. Too long - failing.`);
                throw new Error(`Guesty API rate limit: Please try again in ${hoursToWait} hour(s). Guesty has temporarily limited access to their API.`);
              }
              
              console.log(`Token endpoint rate limited. Retry-After date: ${retryAfter} (${waitTime}ms)`);
            }
          } else {
            waitTime = Math.min(2000 * Math.pow(2, attempt), 30000);
            console.log(`Token endpoint rate limited (no Retry-After header). Using backoff: ${waitTime}ms`);
          }
          
          console.error(`Rate limit error (${response.status}):`, error);
          lastError = new Error(`Authentication failed: ${response.status} - ${error}`);
          
          await delay(Math.max(waitTime, 0));
          continue;
        }
        
        console.error(`Failed to get access token (${response.status}):`, error);
        throw new Error(`Authentication failed: ${response.status} - ${error}`);
      }

      const data = await response.json();
      console.log('Successfully obtained access token');
      return data.access_token;
      
    } catch (error) {
      if (attempt === retries) {
        throw lastError || error;
      }
      lastError = error as Error;
    }
  }
  
  throw lastError || new Error('Failed to obtain access token from Guesty');
}

async function fetchReviewsPage(
  accessToken: string,
  listingId: string,
  limit: number,
  skip: number,
  lastSyncDate?: string
) {
  const url = new URL('https://open-api.guesty.com/v1/reviews');
  url.searchParams.append('listingId', listingId);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('skip', skip.toString());
  // NOTE: Some Guesty deployments reject 'fields' and JSON-encoded 'filters' on this endpoint.
  // We'll avoid both to prevent 400s. Incremental sync can be added later with a safe filter shape.

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const urlStr = url.toString();
      console.log(`Fetching reviews from: ${urlStr}`);
      const response = await fetch(urlStr, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      // Log rate limit headers for monitoring
      const rateLimitSecond = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMinute = response.headers.get('X-ratelimit-remaining-minute');
      const rateLimitHour = response.headers.get('X-ratelimit-remaining-hour');
      
      if (rateLimitSecond || rateLimitMinute || rateLimitHour) {
        console.log(`Rate limits - Second: ${rateLimitSecond}/15, Minute: ${rateLimitMinute}/120, Hour: ${rateLimitHour}/5000`);
      }

      if (response.status === 429) {
        const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
        console.log(`Rate limited (429), retrying after ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoffMs);
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Guesty API error: ${response.status} ${response.statusText} - ${bodyText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
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

    // Get Guesty account credentials
    const { data: guestyAccount, error: accountError } = await supabaseClient
      .from('guesty_accounts')
      .select('client_id, client_secret, last_reviews_sync')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !guestyAccount) {
      throw new Error('Guesty account not found');
    }

    // Get access token with retry logic
    const accessToken = await getGuestyAccessToken(
      guestyAccount.client_id,
      guestyAccount.client_secret
    );

    // Get all active listings for this account from database
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

    // Update total items to track
    await supabaseClient
      .from('sync_jobs')
      .update({
        total_items: totalListings,
        progress_message: `Starting sync for ${totalListings} listings...`,
      })
      .eq('id', syncJobId);

    // Determine if this is an incremental sync
    const lastSyncDate = guestyAccount.last_reviews_sync;

    let totalReviewsSynced = 0;
    let listingsProcessed = 0;

    // Loop through each listing
    for (const listing of listings) {
      listingsProcessed++;
      const listingId = listing.id;
      
      console.log(`Processing listing ${listingsProcessed}/${totalListings}: ${listingId}`);

      let listingReviewsCount = 0;
      let currentOffset = 0;
      let hasMorePages = true;

      // Fetch all reviews for this listing
      while (hasMorePages) {
        console.log(`Fetching reviews for listing ${listingId} (offset: ${currentOffset})`);

        // Fetch reviews page
        const reviewsData = await fetchReviewsPage(
          accessToken,
          listingId,
          REVIEWS_BATCH_SIZE,
          currentOffset,
          lastSyncDate
        );

        const results = reviewsData.results || [];
        console.log(`Received ${results.length} reviews for listing ${listingId}`);

        if (results.length === 0) {
          hasMorePages = false;
          break;
        }

        // Map and upsert reviews
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

        // Check if we've reached the end for this listing
        if (results.length < REVIEWS_BATCH_SIZE) {
          hasMorePages = false;
        }

        // Delay between pages to avoid rate limits
        if (hasMorePages) {
          await delay(REQUEST_DELAY_MS);
        }
      }

      console.log(`Completed listing ${listingId}: ${listingReviewsCount} reviews`);

      // Update sync job progress after each listing
      await supabaseClient
        .from('sync_jobs')
        .update({
          items_synced: listingsProcessed,
          progress_message: `Syncing reviews for listing ${listingsProcessed} of ${totalListings} (${totalReviewsSynced} reviews total)`,
        })
        .eq('id', syncJobId);

      // Delay between listings to avoid rate limits
      if (listingsProcessed < totalListings) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    // Mark sync as completed
    await supabaseClient
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_synced: totalListings,
        progress_message: `Successfully synced ${totalReviewsSynced} reviews from ${totalListings} listings`,
      })
      .eq('id', syncJobId);

    // Update last_reviews_sync timestamp
    await supabaseClient
      .from('guesty_accounts')
      .update({ last_reviews_sync: new Date().toISOString() })
      .eq('id', guestyAccountId);

    console.log(`Review sync completed successfully: ${totalReviewsSynced} reviews synced from ${totalListings} listings`);
  } catch (error) {
    console.error('Review sync failed:', error);
    
    // Update sync job with error
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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Client for user authentication check
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify authentication
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service role client for database operations (bypasses RLS)
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

    // Check for existing running sync job
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
      // Resume existing job
      syncJob = existingJob;
      resumeFromOffset = existingJob.last_synced_offset || 0;
      console.log(`Resuming existing sync job: ${syncJob.id} from offset ${resumeFromOffset}`);
    } else {
      // Create new sync job using service role
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

    // Start background sync using waitUntil
    EdgeRuntime.waitUntil(
      performSync(guestyAccountId, syncJob.id, resumeFromOffset)
    );

    // Return immediately
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
