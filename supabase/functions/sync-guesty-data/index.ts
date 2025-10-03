import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  fareAccommodationAdjusted: number;
  hostPayout: number;
  totalPaid: number;
  ownerRevenue: number;
  listingId: string;
  source: string;
  confirmationCode: string;
  createdAt: string;
  lastUpdatedAt: string;
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
}

async function getGuestyAccessToken(clientId: string, clientSecret: string, retries = 5): Promise<string> {
  let lastError: Error | null = null;
  const MAX_WAIT_TIME = 45000; // 45 seconds max wait (edge functions timeout at 60s)
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.log(`Token retry attempt ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await sleep(backoffDelay);
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
          
          await sleep(Math.max(waitTime, 0));
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
      fields: '_id createdAt nickname status isListed active propertyType accommodates bedrooms address picture pictures',
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
  onProgress?: (fetched: number, saved: number, total?: number) => Promise<void>
) {
  let skip = startOffset;
  const limit = 100;
  const batchSize = 1000; // Save every 1000 records
  let totalFetched = 0;
  let totalSaved = 0;
  let batch: GuestyReservation[] = [];

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
        fields: '_id status checkIn checkOut nightsCount guestsCount fareAccommodationAdjusted hostPayout totalPaid ownerRevenue listingId source confirmationCode createdAt lastUpdatedAt',
      }, 5); // 5 retries

      const reservations = data.results || [];
      batch.push(...reservations);
      totalFetched += reservations.length;
      
      console.log(`Fetched ${reservations.length} reservations (total: ${totalFetched})`);

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
            fare_accommodation_adjusted: reservation.fareAccommodationAdjusted,
            host_payout: reservation.hostPayout,
            total_paid: reservation.totalPaid,
            owner_revenue: reservation.ownerRevenue,
            source: reservation.source,
            confirmation_code: reservation.confirmationCode,
            created_at_guesty: reservation.createdAt,
            last_updated_at_guesty: reservation.lastUpdatedAt,
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
          console.log(`Saved batch successfully. Total saved: ${totalSaved}`);
          
          // Update progress
          if (onProgress) {
            await onProgress(totalFetched, totalSaved, data.count);
          }
          
          // Update job with last synced offset for resumability
          await updateSyncJob(supabase, jobId, {
            progress_message: `Saved ${totalSaved} reservations (fetched ${totalFetched}${data.count ? `/${data.count}` : ''})`,
            items_synced: totalSaved,
            total_items: data.count,
            last_synced_offset: skip,
          });
          
          // Clear batch
          batch = [];
        }
      } else if (onProgress) {
        // Update progress without saving
        await onProgress(totalFetched, totalSaved, data.count);
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
            fare_accommodation_adjusted: reservation.fareAccommodationAdjusted,
            host_payout: reservation.hostPayout,
            total_paid: reservation.totalPaid,
            owner_revenue: reservation.ownerRevenue,
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

  return { totalFetched, totalSaved };
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
    const { accountId, syncType, startDate } = await req.json();

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

    const accessToken = await getGuestyAccessToken(account.client_id, account.client_secret);

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

        const listingsToUpsert = guestyListings.map((listing: GuestyListing) => {
          // Extract thumbnail from picture or pictures array
          let thumbnail = null;
          if (listing.picture?.thumbnail) {
            thumbnail = listing.picture.thumbnail;
          } else if (listing.pictures && listing.pictures.length > 0 && listing.pictures[0].thumbnail) {
            thumbnail = listing.pictures[0].thumbnail;
          }
          
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
      // Check for existing incomplete sync job
      const { data: existingJobs } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', 'reservations')
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1);
      
      let jobId: string;
      let startOffsetValue = 0;
      
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
      
      try {
        const defaultStartDate = startDate || new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        await updateSyncJob(supabase, jobId, { 
          progress_message: `${startOffsetValue > 0 ? 'Resuming' : 'Starting'} reservations sync (checkIn >= ${defaultStartDate})...` 
        });

        const { totalFetched, totalSaved } = await fetchAndSaveReservationsBatch(
          accessToken,
          defaultStartDate,
          supabase,
          accountId,
          jobId,
          startOffsetValue,
          async (fetched, saved, total) => {
            await updateSyncJob(supabase, jobId, {
              progress_message: `Processing: fetched ${fetched}, saved ${saved}${total ? `/${total}` : ''}`,
              items_synced: saved,
              total_items: total,
            });
          }
        );

        reservationsCount = totalSaved;

        await updateSyncJob(supabase, jobId, {
          status: 'completed',
          progress_message: `Completed: ${totalSaved} reservations synced (fetched ${totalFetched})`,
          items_synced: totalSaved,
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
