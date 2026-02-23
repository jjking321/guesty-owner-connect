import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GuestyReservation {
  _id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nightsCount: number;
  guestsCount: number;
  listingId: string;
  source: string;
  confirmationCode: string;
  createdAt: string;
  lastUpdatedAt: string;
  money?: {
    fareAccommodationAdjusted?: number;
    hostPayout?: number;
    totalPaid?: number;
    ownerRevenue?: number;
    totalTaxes?: number;
  };
  guest?: {
    fullName?: string;
  };
}

interface GuestyListing {
  _id: string;
  createdAt: string;
  nickname: string;
  status: string;
  isListed: boolean;
  active: boolean;
  propertyType: string;
  accommodates: number;
  bedrooms: number;
  address: any;
  picture?: {
    thumbnail?: string;
    _id?: string;
    original?: string;
  };
  pictures?: Array<{
    thumbnail?: string;
    _id?: string;
    original?: string;
  }>;
  integrations?: Array<{
    platform?: string;
    airbnb2?: {
      id?: string;
      externalId?: string;
    };
  }>;
}

const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000;
const TOKEN_BUFFER_MS = 120000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 1000;
const LOCK_MAX_POLLS = 6;

// Self-invocation constants for handling large datasets
const RESERVATION_BATCH_LIMIT = 3000; // Process this many records before self-invoking
const FUNCTION_TIMEOUT_BUFFER = 50000; // 50 seconds - leave 10s buffer before edge function timeout

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
  const { data: tokenRow } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .select('*')
    .eq('guesty_account_id', accountId)
    .maybeSingle();

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
    .update({ refresh_in_progress: true, refresh_started_at: now, updated_at: now })
    .eq('guesty_account_id', accountId)
    .or(`refresh_in_progress.eq.false,refresh_started_at.lt.${staleThreshold}`)
    .select();

  const lockAcquired = !lockError && lockResult && lockResult.length > 0;

  if (!lockAcquired && tokenRow) {
    for (let poll = 0; poll < LOCK_MAX_POLLS; poll++) {
      await sleep(LOCK_POLL_INTERVAL_MS);
      const { data: polledToken } = await supabaseAdmin.from('guesty_oauth_tokens').select('*').eq('guesty_account_id', accountId).maybeSingle();
      if (polledToken && !polledToken.refresh_in_progress) {
        const expiresAt = new Date(polledToken.expires_at).getTime();
        if (expiresAt > Date.now() + TOKEN_BUFFER_MS) return polledToken.access_token;
      }
    }
  }

  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    await supabaseAdmin.from('guesty_oauth_tokens').upsert({
      guesty_account_id: accountId, access_token: token, expires_at: expiresAt,
      oauth_cooldown_until: null, refresh_in_progress: false, refresh_started_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'guesty_account_id' });
    return token;
  } catch (error: any) {
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      const cooldownUntil = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      await supabaseAdmin.from('guesty_oauth_tokens').upsert({
        guesty_account_id: accountId, access_token: tokenRow?.access_token || '', expires_at: tokenRow?.expires_at || new Date().toISOString(),
        oauth_cooldown_until: cooldownUntil, refresh_in_progress: false, refresh_started_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'guesty_account_id' });
    } else {
      await supabaseAdmin.from('guesty_oauth_tokens').update({ refresh_in_progress: false, refresh_started_at: null }).eq('guesty_account_id', accountId);
    }
    throw error;
  }
}

async function fetchGuestyOAuthToken(clientId: string, clientSecret: string): Promise<string> {
  const start = Date.now();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'open-api' }),
    });
    if (tokenResponse.status === 429) {
      const retryAfterMs = parseRetryAfter(tokenResponse.headers.get('retry-after'));
      const waitTime = Math.max(Math.min(2000 * Math.pow(2, attempt - 1), 30000), retryAfterMs || 0);
      if (Date.now() - start + waitTime > MAX_WAIT_TIME) {
        throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${Math.max(3, Math.ceil(retryAfterMs / 60000))} minutes.`);
      }
      await sleep(waitTime);
      continue;
    }
    if (!tokenResponse.ok) throw new Error(`Failed to get access token: ${tokenResponse.status}`);
    const { access_token } = await tokenResponse.json();
    return access_token;
  }
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate after multiple attempts. Please wait 3 minutes.');
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGuestyData(apiToken: string, endpoint: string, params: any = {}, retries = 3) {
  const url = new URL(`https://open-api.guesty.com/v1/${endpoint}`);
  
  // Add query parameters
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, params[key].toString());
    }
  });

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Add throttling delay between requests (except first attempt)
      if (attempt > 0) {
        const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        console.log(`Retry attempt ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await sleep(backoffDelay);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      // Log rate limit headers for monitoring
      const rateLimitSecond = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMinute = response.headers.get('X-ratelimit-remaining-minute');
      const rateLimitHour = response.headers.get('X-ratelimit-remaining-hour');
      
      if (rateLimitSecond || rateLimitMinute || rateLimitHour) {
        console.log(`Rate limits - Second: ${rateLimitSecond}/15, Minute: ${rateLimitMinute}/120, Hour: ${rateLimitHour}/5000`);
      }

      if (!response.ok) {
        const error = await response.text();
        
        // Handle specific error codes according to Guesty docs
        switch (response.status) {
          case 400:
            throw new Error(`Bad Request - Invalid request format: ${error}`);
          
          case 401:
            throw new Error(`Unauthorized - Access token expired. Please reconnect your Guesty account.`);
          
          case 403:
            throw new Error(`Forbidden - Account inactive or insufficient permissions: ${error}`);
          
          case 404:
            console.log(`Resource not found (404), continuing...`);
            return { results: [], count: 0 }; // Return empty for not found
          
          case 405:
            throw new Error(`Method Not Allowed - Invalid HTTP method for this endpoint`);
          
          case 406:
            throw new Error(`Not Acceptable - Response format must be JSON`);
          
          case 410:
            console.log(`Resource gone (410), continuing...`);
            return { results: [], count: 0 }; // Return empty for gone resources
          
          case 429:
            // Rate limit - check Retry-After and attempt retry
            if (attempt < retries) {
              const retryAfter = response.headers.get('Retry-After');
              if (retryAfter) {
                const retryAfterNum = parseInt(retryAfter);
                const waitTime = !isNaN(retryAfterNum) ? retryAfterNum * 1000 : 5000;
                
                // Cap wait time at 45 seconds
                if (waitTime > 45000) {
                  throw new Error(`Rate limit requires waiting ${Math.round(waitTime/1000)}s. Please try again later.`);
                }
                
                console.log(`Rate limited (429). Waiting ${waitTime}ms before retry...`);
                await sleep(waitTime);
                continue;
              }
            }
            throw new Error(`Too Many Requests - Rate limit exceeded: ${error}`);
          
          case 500:
            // Internal server error - retry
            if (attempt < retries) {
              console.error(`Server error (500), will retry:`, error);
              lastError = new Error(`Internal Server Error: ${error}`);
              continue;
            }
            throw new Error(`Guesty server error. Please try again later: ${error}`);
          
          case 503:
            // Service unavailable - retry
            if (attempt < retries) {
              console.error(`Service unavailable (503), will retry:`, error);
              lastError = new Error(`Service Unavailable: ${error}`);
              continue;
            }
            throw new Error(`Guesty service temporarily unavailable. Please try again later.`);
          
          default:
            console.error(`Guesty API error (${response.status}):`, error);
            throw new Error(`Guesty API error: ${response.status} - ${error}`);
        }
      }

      return await response.json();
      
    } catch (error) {
      if (attempt === retries) {
        throw lastError || error;
      }
      lastError = error as Error;
    }
  }
  
  throw lastError || new Error('Failed to fetch data from Guesty');
}

async function fetchAllListings(apiToken: string, onProgress?: (fetched: number, total?: number) => Promise<void>) {
  const allListings: GuestyListing[] = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    console.log(`Fetching listings: skip=${skip}, limit=${limit}`);
    const data = await fetchGuestyData(apiToken, 'listings', {
      limit,
      skip,
      fields: '_id createdAt nickname status isListed active propertyType accommodates bedrooms address picture pictures integrations',
    }, 5); // 5 retries for listings

    const listings = data.results || [];
    allListings.push(...listings);
    
    if (onProgress) {
      await onProgress(allListings.length, data.count);
    }
    
    console.log(`Fetched ${listings.length} listings`);

    if (listings.length < limit) {
      break;
    }

    skip += limit;
    
    // Increased delay to stay well under rate limits (15 req/sec = 67ms min)
    // Using 350ms = ~3 req/sec to be conservative
    await sleep(350);
  }

  return allListings;
}

async function fetchAndSaveReservationsBatch(
  apiToken: string,
  startDate: string,
  supabase: any,
  accountId: string,
  jobId: string,
  startOffset: number = 0,
  startTime: number = Date.now(),
  onProgress?: (fetched: number, saved: number, total?: number, absoluteProcessed?: number) => Promise<void>
): Promise<{ totalFetched: number; totalSaved: number; needsContinuation: boolean; nextOffset: number; cancelled: boolean }> {
  let skip = startOffset;
  const limit = 100;
  const batchSize = 1000; // Save every 1000 records
  let totalFetched = 0;
  let totalSaved = 0;
  let batch: GuestyReservation[] = [];
  let recordsProcessedThisInvocation = 0;

  while (true) {
    console.log(`Fetching reservations: skip=${skip}, limit=${limit}`);
    
    const filters = JSON.stringify([
      {
        field: 'checkIn',
        operator: '$gte',
        value: startDate,
      }
    ]);

    try {
      const data = await fetchGuestyData(apiToken, 'reservations', {
        limit,
        skip,
        filters,
        fields: '_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue money.totalTaxes guest.fullName',
      }, 5); // 5 retries

      const reservations = data.results || [];
      batch.push(...reservations);
      totalFetched += reservations.length;
      recordsProcessedThisInvocation += reservations.length;
      
      console.log(`Fetched ${reservations.length} reservations (total: ${totalFetched}, this invocation: ${recordsProcessedThisInvocation})`);

      // Save batch if it reaches batch size or if it's the last batch
      if (batch.length >= batchSize || reservations.length < limit) {
        if (batch.length > 0) {
          console.log(`Saving batch of ${batch.length} reservations...`);
          
          const reservationsToUpsert = batch.map((reservation: GuestyReservation) => ({
            id: reservation._id,
            guesty_account_id: accountId,
            listing_id: reservation.listingId,
            status: reservation.status,
            check_in: reservation.checkIn,
            check_out: reservation.checkOut,
            nights_count: reservation.nightsCount,
            guests_count: reservation.guestsCount,
            fare_accommodation_adjusted: reservation.money?.fareAccommodationAdjusted,
            host_payout: reservation.money?.hostPayout,
            total_paid: reservation.money?.totalPaid,
            owner_revenue: reservation.money?.ownerRevenue,
            tax_amount: reservation.money?.totalTaxes,
            source: reservation.source,
            confirmation_code: reservation.confirmationCode,
            created_at_guesty: reservation.createdAt,
            last_updated_at_guesty: reservation.lastUpdatedAt,
            guest_name: reservation.guest?.fullName || null,
            updated_at: new Date().toISOString(),
          }));

          // Deduplicate reservations by ID
          const uniqueReservations = Array.from(
            new Map(reservationsToUpsert.map(item => [item.id, item])).values()
          );
          
          console.log(`Deduplication: ${reservationsToUpsert.length} -> ${uniqueReservations.length} unique reservations`);

          const { error: reservationsError } = await supabase
            .from('reservations')
            .upsert(uniqueReservations, { onConflict: 'id' });

          if (reservationsError) {
            console.error('Error saving reservations batch:', reservationsError);
            throw reservationsError;
          }

          totalSaved += uniqueReservations.length;
          const absoluteProcessed = skip + limit; // Use offset-based progress (monotonic)
          console.log(`Saved batch successfully. Total saved this invocation: ${totalSaved}, Absolute processed: ${absoluteProcessed}`);
          
          // Update progress with absolute offset-based count
          if (onProgress) {
            await onProgress(totalFetched, totalSaved, data.count, absoluteProcessed);
          }
          
          // Update job with last synced offset for resumability
          // Use absolute processed offset for items_synced (monotonic across invocations)
          await updateSyncJob(supabase, jobId, {
            progress_message: `Processed ${absoluteProcessed.toLocaleString()}${data.count ? ` of ${data.count.toLocaleString()}` : ''} (saved +${totalSaved.toLocaleString()} this batch)`,
            items_synced: absoluteProcessed, // MONOTONIC: offset-based, never resets
            total_items: data.count,
            last_synced_offset: skip + limit,
          });
          
          // Check if job was cancelled (user clicked Stop)
          const { data: jobStatus } = await supabase
            .from('sync_jobs')
            .select('status')
            .eq('id', jobId)
            .single();
          
          if (jobStatus && jobStatus.status !== 'running') {
            console.log(`Job ${jobId} was cancelled (status: ${jobStatus.status}), stopping gracefully`);
            return { totalFetched, totalSaved, needsContinuation: false, nextOffset: 0, cancelled: true };
          }
          
          // Clear batch
          batch = [];
        }
      } else if (onProgress) {
        // Update progress without saving (use current offset as absolute progress)
        await onProgress(totalFetched, totalSaved, data.count, skip + reservations.length);
      }

      // Check if we need to self-invoke (approaching timeout or batch limit)
      const elapsedTime = Date.now() - startTime;
      const shouldContinueLater = (
        recordsProcessedThisInvocation >= RESERVATION_BATCH_LIMIT ||
        elapsedTime >= FUNCTION_TIMEOUT_BUFFER
      );

      if (shouldContinueLater && reservations.length >= limit) {
        console.log(`Self-invocation needed: processed ${recordsProcessedThisInvocation} records in ${Math.round(elapsedTime/1000)}s. Next offset: ${skip + limit}`);
        return { 
          totalFetched, 
          totalSaved, 
          needsContinuation: true, 
          nextOffset: skip + limit,
          cancelled: false
        };
      }

      if (reservations.length < limit) {
        break;
      }

      skip += limit;
      
      // Increased delay to stay well under rate limits (15 req/sec = 67ms min)
      // Using 350ms = ~3 req/sec to be conservative
      await sleep(350);
      
    } catch (error) {
      console.error(`Error at skip=${skip}:`, error);
      
      // Save what we have so far before failing
      if (batch.length > 0) {
        console.log(`Attempting to save partial batch of ${batch.length} reservations before failing...`);
        try {
          const reservationsToUpsert = batch.map((reservation: GuestyReservation) => ({
            id: reservation._id,
            guesty_account_id: accountId,
            listing_id: reservation.listingId,
            status: reservation.status,
            check_in: reservation.checkIn,
            check_out: reservation.checkOut,
            nights_count: reservation.nightsCount,
            guests_count: reservation.guestsCount,
            fare_accommodation_adjusted: reservation.money?.fareAccommodationAdjusted,
            host_payout: reservation.money?.hostPayout,
            total_paid: reservation.money?.totalPaid,
            owner_revenue: reservation.money?.ownerRevenue,
            source: reservation.source,
            confirmation_code: reservation.confirmationCode,
            created_at_guesty: reservation.createdAt,
            last_updated_at_guesty: reservation.lastUpdatedAt,
            updated_at: new Date().toISOString(),
          }));

          const uniqueReservations = Array.from(
            new Map(reservationsToUpsert.map(item => [item.id, item])).values()
          );

          await supabase
            .from('reservations')
            .upsert(uniqueReservations, { onConflict: 'id' });

          totalSaved += uniqueReservations.length;
          console.log(`Saved partial batch. Total saved before failure: ${totalSaved}`);
        } catch (saveError) {
          console.error('Failed to save partial batch:', saveError);
        }
      }
      
      throw error;
    }
  }

  return { totalFetched, totalSaved, needsContinuation: false, nextOffset: 0, cancelled: false };
}

async function createSyncJob(supabase: any, accountId: string, syncType: string): Promise<string> {
  const { data, error } = await supabase
    .from('sync_jobs')
    .insert({
      guesty_account_id: accountId,
      sync_type: syncType,
      status: 'running',
      progress_message: 'Starting sync...',
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

async function updateSyncJob(supabase: any, jobId: string, updates: any) {
  const { error } = await supabase
    .from('sync_jobs')
    .update(updates)
    .eq('id', jobId);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract auth token for self-invocation
    const authHeader = req.headers.get('Authorization');
    const authToken = authHeader?.replace('Bearer ', '') || '';
    
    const { accountId, syncType, startDate, resumeJobId } = await req.json();

    if (!accountId) {
      throw new Error('accountId is required');
    }

    if (!syncType || !['listings', 'reservations', 'both'].includes(syncType)) {
      throw new Error('syncType must be "listings", "reservations", or "both"');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    console.log(`Starting sync for account: ${account.account_name}, type: ${syncType}`);

    const accessToken = await getGuestyAccessTokenCached(supabase, accountId, account.client_id, account.client_secret);

    let listingsCount = 0;
    let reservationsCount = 0;

    // Sync listings
    if (syncType === 'listings' || syncType === 'both') {
      const jobId = await createSyncJob(supabase, accountId, 'listings');
      
      try {
        await updateSyncJob(supabase, jobId, { progress_message: 'Fetching listings from Guesty...' });
        
        const guestyListings = await fetchAllListings(accessToken, async (fetched, total) => {
          await updateSyncJob(supabase, jobId, {
            progress_message: `Fetching listings: ${fetched}${total ? `/${total}` : ''}`,
            items_synced: fetched,
            total_items: total,
          });
        });

        await updateSyncJob(supabase, jobId, { progress_message: 'Saving listings to database...' });

  // Debug: Log first listing's integrations field to see what Guesty returns
  if (guestyListings.length > 0) {
    const firstListing = guestyListings[0];
    console.log(`DEBUG: First listing integrations field:`, JSON.stringify(firstListing.integrations));
    console.log(`DEBUG: First listing keys:`, Object.keys(firstListing));
  }
  
  // Count listings with Airbnb integrations for logging
  const listingsWithAirbnb = guestyListings.filter((l: GuestyListing) => {
    const airbnbIntegration = l.integrations?.find((i: any) => i.platform === 'airbnb2');
    return airbnbIntegration?.airbnb2?.id;
  });
  console.log(`DEBUG: ${listingsWithAirbnb.length} of ${guestyListings.length} listings have Airbnb integration`);

  const listingsToUpsert = guestyListings.map((listing: GuestyListing) => {
    // Extract thumbnail from picture or pictures array
    let thumbnail = null;
    if (listing.picture?.thumbnail) {
      thumbnail = listing.picture.thumbnail;
    } else if (listing.pictures && listing.pictures.length > 0 && listing.pictures[0].thumbnail) {
      thumbnail = listing.pictures[0].thumbnail;
    }
    
    // Store the full pictures array for higher quality images
    const pictures = listing.pictures || [];
    
    // Extract Airbnb listing ID from integrations array
    const airbnbIntegration = listing.integrations?.find((i: any) => i.platform === 'airbnb2');
    const airbnbListingId = airbnbIntegration?.airbnb2?.id || null;
    
    return {
      id: listing._id,
      guesty_account_id: accountId,
      created_at_guesty: listing.createdAt,
      nickname: listing.nickname,
      status: listing.status,
      is_listed: listing.isListed,
      active: listing.active,
      property_type: listing.propertyType,
      accommodates: listing.accommodates,
      bedrooms: listing.bedrooms,
      address: listing.address,
      thumbnail: thumbnail,
      pictures: pictures,
      airbnb_listing_id: airbnbListingId,
      updated_at: new Date().toISOString(),
    };
  });

        // Deduplicate listings by ID (keep last occurrence)
        const uniqueListings = Array.from(
          new Map(listingsToUpsert.map(item => [item.id, item])).values()
        );
        
        console.log(`Deduplication: ${listingsToUpsert.length} -> ${uniqueListings.length} unique listings`);

        if (uniqueListings.length > 0) {
          const { error: listingsError } = await supabase
            .from('listings')
            .upsert(uniqueListings, { onConflict: 'id' });

          if (listingsError) throw listingsError;
        }

        listingsCount = uniqueListings.length;

        await updateSyncJob(supabase, jobId, {
          status: 'completed',
          progress_message: `Completed: ${listingsCount} listings synced`,
          items_synced: listingsCount,
          completed_at: new Date().toISOString(),
        });

        await supabase
          .from('guesty_accounts')
          .update({ last_listings_sync: new Date().toISOString() })
          .eq('id', accountId);

      } catch (error) {
        await updateSyncJob(supabase, jobId, {
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        });
        throw error;
      }
    }

    // Sync reservations with batch processing
    if (syncType === 'reservations' || syncType === 'both') {
      let jobId: string;
      let startOffsetValue = 0;
      
      // If resumeJobId is provided (from self-invocation), use that job
      if (resumeJobId) {
        const { data: resumeJob } = await supabase
          .from('sync_jobs')
          .select('*')
          .eq('id', resumeJobId)
          .single();
        
        if (resumeJob && resumeJob.status === 'running') {
          jobId = resumeJob.id;
          startOffsetValue = resumeJob.last_synced_offset || 0;
          console.log(`Continuing from resumeJobId ${resumeJobId}, offset ${startOffsetValue}`);
        } else {
          // Job was cancelled or completed, don't continue
          console.log(`Resume job ${resumeJobId} is not running, skipping`);
          return new Response(
            JSON.stringify({ success: true, message: 'Job was cancelled or already completed' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // Check for existing incomplete sync job
        const { data: existingJobs } = await supabase
          .from('sync_jobs')
          .select('*')
          .eq('guesty_account_id', accountId)
          .eq('sync_type', 'reservations')
          .eq('status', 'running')
          .order('started_at', { ascending: false })
          .limit(1);
        
        if (existingJobs && existingJobs.length > 0) {
          // Resume from existing job
          const existingJob = existingJobs[0];
          jobId = existingJob.id;
          startOffsetValue = existingJob.last_synced_offset || 0;
          console.log(`Resuming reservations sync from offset ${startOffsetValue}. Already synced: ${existingJob.items_synced}`);
          
          await updateSyncJob(supabase, jobId, {
            progress_message: `Resuming sync from ${startOffsetValue} reservations...`,
          });
        } else {
          // Create new sync job
          jobId = await createSyncJob(supabase, accountId, 'reservations');
          console.log('Starting new reservations sync from beginning');
        }
      }
      
      try {
        const defaultStartDate = startDate || new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        await updateSyncJob(supabase, jobId, { 
          progress_message: `${startOffsetValue > 0 ? 'Resuming' : 'Starting'} reservations sync (checkIn >= ${defaultStartDate})...` 
        });

        const syncStartTime = Date.now();
        
        const { totalFetched, totalSaved, needsContinuation, nextOffset, cancelled } = await fetchAndSaveReservationsBatch(
          accessToken,
          defaultStartDate,
          supabase,
          accountId,
          jobId,
          startOffsetValue,
          syncStartTime,
          async (fetched: number, saved: number, total?: number, absoluteProcessed?: number) => {
            // Use absoluteProcessed (offset-based) for items_synced to maintain monotonic progress
            const progressValue = absoluteProcessed ?? (startOffsetValue + fetched);
            await updateSyncJob(supabase, jobId, {
              progress_message: `Processed ${progressValue.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} (saved +${saved.toLocaleString()} this batch)`,
              items_synced: progressValue, // MONOTONIC: offset-based progress
              total_items: total,
            });
          }
        );

        reservationsCount = totalSaved;

        // If cancelled by user, exit gracefully without self-invocation
        if (cancelled) {
          console.log('Sync was cancelled by user, exiting gracefully');
          return new Response(
            JSON.stringify({
              success: true,
              listingsCount,
              reservationsCount,
              cancelled: true,
              message: 'Sync was stopped by user',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // If self-invocation is needed, trigger continuation and return early
        if (needsContinuation) {
          console.log(`Self-invoking to continue from offset ${nextOffset}...`);
          
          await updateSyncJob(supabase, jobId, {
            progress_message: `Processed ${nextOffset.toLocaleString()} so far. Continuing in next batch...`,
            items_synced: nextOffset, // MONOTONIC: use nextOffset as absolute progress
            last_synced_offset: nextOffset,
          });

          // Self-invoke to continue processing
          const { error: invokeError } = await supabase.functions.invoke('sync-guesty-data', {
            headers: { Authorization: `Bearer ${authToken}` },
            body: { accountId, syncType: 'reservations', startDate: defaultStartDate, resumeJobId: jobId },
          });

          if (invokeError) {
            console.error('Self-invocation failed:', invokeError);
            // Don't fail - the job is still running and can be resumed manually
          }

          // Return success - the continuation will handle the rest
          return new Response(
            JSON.stringify({
              success: true,
              listingsCount,
              reservationsCount,
              continuing: true,
              message: `Processed ${nextOffset} reservations. Continuation triggered.`,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Sync completed fully - use absolute offset for final count
        const finalProcessed = startOffsetValue + totalFetched;
        await updateSyncJob(supabase, jobId, {
          status: 'completed',
          progress_message: `Completed: ${finalProcessed.toLocaleString()} reservations processed (${totalSaved.toLocaleString()} saved this batch)`,
          items_synced: finalProcessed, // MONOTONIC: absolute offset-based final count
          completed_at: new Date().toISOString(),
          last_synced_offset: 0,
        });

        await supabase
          .from('guesty_accounts')
          .update({ last_reservations_sync: new Date().toISOString() })
          .eq('id', accountId);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Reservation sync failed:', errorMsg);
        
        await updateSyncJob(supabase, jobId, {
          status: 'failed',
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
        });
        
        // Don't throw - let partial success be visible to user
        console.log('Reservation sync failed but partial data may have been saved');
      }
    }

    console.log('Sync completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        listingsCount,
        reservationsCount,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in sync-guesty-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
