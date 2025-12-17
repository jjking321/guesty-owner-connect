import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Process 50 listings per invocation (~75-90 seconds)
const BATCH_SIZE = 50;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGuestyAccessToken(clientId: string, clientSecret: string, retries = 5): Promise<string> {
  let lastError: Error | null = null;
  const MAX_WAIT_TIME = 45000;
  
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
        
        if (response.status === 429 && attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          let waitTime: number;
          
          if (retryAfter) {
            const retryAfterNum = parseInt(retryAfter);
            if (!isNaN(retryAfterNum)) {
              waitTime = retryAfterNum * 1000;
              if (waitTime > MAX_WAIT_TIME) {
                throw new Error(`Guesty API rate limit: Please try again later.`);
              }
              console.log(`Token endpoint rate limited. Retry-After: ${retryAfterNum}s`);
            } else {
              const retryDate = new Date(retryAfter);
              waitTime = retryDate.getTime() - Date.now();
              if (waitTime > MAX_WAIT_TIME) {
                throw new Error(`Guesty API rate limit: Please try again later.`);
              }
            }
          } else {
            waitTime = Math.min(2000 * Math.pow(2, attempt), 30000);
          }
          
          console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
          lastError = new Error(`Authentication failed: ${response.status} - ${error}`);
          await sleep(Math.max(waitTime, 0));
          continue;
        }
        
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

async function fetchCalendarData(
  apiToken: string, 
  listingId: string, 
  startDate: string, 
  endDate: string,
  retries = 3
): Promise<any> {
  const url = new URL('https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings');
  url.searchParams.set('listingIds', listingId);
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.min(500 * Math.pow(2, attempt), 5000);
        console.log(`Calendar fetch retry ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await sleep(backoffDelay);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
      });

      const rateLimitSec = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMin = response.headers.get('X-ratelimit-remaining-minute');
      console.log(`Rate limits - sec: ${rateLimitSec}, min: ${rateLimitMin}`);

      if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 429 && attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
          console.log(`Rate limited (429), waiting ${waitTime}ms...`);
          await sleep(waitTime);
          continue;
        }
        
        throw new Error(`Guesty API error (${response.status}): ${errorText}`);
      }

      return await response.json();
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.error(`Calendar fetch attempt ${attempt} failed:`, error);
    }
  }
  
  throw new Error('Failed to fetch calendar data after retries');
}

function processCalendarData(calendarData: any, listingId: string, syncedAt: string): any[] {
  const records: any[] = [];
  
  const processDay = (day: any, dateKey?: string) => {
    const date = dateKey || day.date;
    records.push({
      listing_id: listingId,
      date,
      price: day.price || null,
      currency: day.currency || 'USD',
      min_nights: day.minNights || null,
      status: day.status || null,
      is_available: day.status === 'available',
      cta: day.cta || false,
      ctd: day.ctd || false,
      block_reason: day.status === 'booked' ? 'reservation' : (day.status === 'unavailable' ? 'blocked' : null),
      synced_from_guesty_at: syncedAt,
    });
  };

  if (Array.isArray(calendarData)) {
    calendarData.forEach(day => processDay(day));
  } else if (calendarData.data?.days && Array.isArray(calendarData.data.days)) {
    calendarData.data.days.forEach((day: any) => processDay(day));
  } else if (calendarData.data && Array.isArray(calendarData.data)) {
    calendarData.data.forEach((day: any) => processDay(day));
  } else if (calendarData.data?.[listingId]?.days) {
    Object.entries(calendarData.data[listingId].days).forEach(([dateStr, day]) => processDay(day as any, dateStr));
  } else if (calendarData[listingId]) {
    const listingData = calendarData[listingId];
    if (Array.isArray(listingData)) {
      listingData.forEach((day: any) => processDay(day));
    } else if (listingData.days) {
      Object.entries(listingData.days).forEach(([dateStr, day]) => processDay(day as any, dateStr));
    }
  }

  return records;
}

async function performSync(
  supabase: any,
  guestyAccountId: string,
  syncJobId: string,
  resumeFromOffset: number,
  authToken: string
) {
  console.log(`Starting bulk calendar sync for account ${guestyAccountId}, resuming from offset ${resumeFromOffset}`);

  try {
    // Get Guesty credentials
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    // Get all active listings for this account
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('guesty_account_id', guestyAccountId)
      .eq('archived', false)
      .order('nickname');

    if (listingsError) throw listingsError;
    if (!listings || listings.length === 0) {
      await supabase.from('sync_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress_message: 'No listings to sync',
      }).eq('id', syncJobId);
      return;
    }

    // Update job with total count
    await supabase.from('sync_jobs').update({
      total_items: listings.length,
      progress_message: `Starting sync of ${listings.length} listings...`,
    }).eq('id', syncJobId);

    // Get access token
    const accessToken = await getGuestyAccessToken(account.client_id, account.client_secret);

    // Calculate date range
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 365);
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const syncedAt = new Date().toISOString();

    let totalDaysSynced = 0;

    // Process each listing starting from offset
    for (let i = resumeFromOffset; i < listings.length; i++) {
      const listing = listings[i];
      
      // Check if job was cancelled
      const { data: jobCheck } = await supabase
        .from('sync_jobs')
        .select('status')
        .eq('id', syncJobId)
        .single();
      
      if (jobCheck?.status === 'failed') {
        console.log('Job cancelled, stopping sync');
        return;
      }

      console.log(`Syncing calendar for listing ${i + 1}/${listings.length}: ${listing.nickname || listing.id}`);

      try {
        // Fetch calendar data for this listing
        const calendarData = await fetchCalendarData(accessToken, listing.id, startDateStr, endDateStr);
        
        // Process and upsert
        const records = processCalendarData(calendarData, listing.id, syncedAt);
        
        if (records.length > 0) {
          // Upsert in batches
          const batchSize = 100;
          for (let j = 0; j < records.length; j += batchSize) {
            const batch = records.slice(j, j + batchSize);
            const { error: upsertError } = await supabase
              .from('capacity_calendar')
              .upsert(batch, { onConflict: 'listing_id,date' });
            
            if (upsertError) {
              console.error(`Upsert error for listing ${listing.id}:`, upsertError);
            }
          }
          totalDaysSynced += records.length;
        }

        // Update progress
        await supabase.from('sync_jobs').update({
          items_synced: i + 1,
          last_synced_offset: i,
          progress_message: `Synced ${listing.nickname || listing.id} (${i + 1}/${listings.length}) - ${records.length} days`,
        }).eq('id', syncJobId);

      } catch (listingError: any) {
        console.error(`Error syncing listing ${listing.id}:`, listingError.message);
        // Continue with next listing
      }

      // Rate limit delay - 500ms between listings
      await sleep(500);

      // Check if we've hit the batch limit and need to self-invoke
      const itemsProcessedThisBatch = i - resumeFromOffset + 1;
      if (itemsProcessedThisBatch >= BATCH_SIZE && i < listings.length - 1) {
        // Update progress before self-invoking
        await supabase.from('sync_jobs').update({
          items_synced: i + 1,
          last_synced_offset: i,
          progress_message: `Processed ${i + 1}/${listings.length} listings. Continuing in next batch...`,
        }).eq('id', syncJobId);

        console.log(`Batch of ${BATCH_SIZE} complete at listing ${i + 1}. Self-invoking for continuation...`);

        // Self-invoke to continue with next batch
        const { error: invokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
          headers: { Authorization: `Bearer ${authToken}` },
          body: { guestyAccountId },
        });

        if (invokeError) {
          console.error('Self-invocation failed:', invokeError);
          // Don't throw - job can be resumed manually
        }

        return; // Exit this invocation
      }
    }

    // Mark as completed and update last sync timestamp
    await supabase.from('sync_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_synced: listings.length,
      progress_message: `Completed! Synced ${totalDaysSynced} calendar days across ${listings.length} listings`,
    }).eq('id', syncJobId);

    await supabase.from('guesty_accounts').update({
      last_calendar_sync: new Date().toISOString(),
    }).eq('id', guestyAccountId);

    console.log(`Bulk calendar sync completed. ${totalDaysSynced} days across ${listings.length} listings`);

  } catch (error: any) {
    console.error('Bulk calendar sync error:', error);
    await supabase.from('sync_jobs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error.message,
    }).eq('id', syncJobId);
  }
}

// Shutdown handler for logging
addEventListener('beforeunload', (ev: any) => {
  console.log('Function shutdown due to:', ev.detail?.reason);
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract auth token for self-invocation
    const authToken = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { guestyAccountId } = await req.json();
    
    if (!guestyAccountId) {
      return new Response(
        JSON.stringify({ error: 'guestyAccountId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Bulk calendar sync requested for account: ${guestyAccountId}`);

    // Check for existing running job
    const { data: existingJob } = await supabase
      .from('sync_jobs')
      .select('*')
      .eq('guesty_account_id', guestyAccountId)
      .eq('sync_type', 'capacity_calendar')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    let syncJobId: string;
    let resumeFromOffset = 0;
    let isResuming = false;

    if (existingJob) {
      // Resume existing job
      syncJobId = existingJob.id;
      resumeFromOffset = (existingJob.last_synced_offset || 0) + 1;
      isResuming = true;
      console.log(`Resuming existing job ${syncJobId} from offset ${resumeFromOffset}`);
    } else {
      // Create new sync job
      const { data: newJob, error: jobError } = await supabase
        .from('sync_jobs')
        .insert({
          guesty_account_id: guestyAccountId,
          sync_type: 'capacity_calendar',
          status: 'running',
          started_at: new Date().toISOString(),
          items_synced: 0,
          progress_message: 'Initializing calendar sync...',
        })
        .select()
        .single();

      if (jobError || !newJob) {
        throw new Error('Failed to create sync job');
      }
      
      syncJobId = newJob.id;
      console.log(`Created new sync job: ${syncJobId}`);
    }

    // Start background sync with auth token for self-invocation
    EdgeRuntime.waitUntil(performSync(supabase, guestyAccountId, syncJobId, resumeFromOffset, authToken));

    return new Response(
      JSON.stringify({ 
        success: true, 
        syncJobId,
        message: isResuming ? 'Resuming calendar sync' : 'Calendar sync started',
        resumeFromOffset: isResuming ? resumeFromOffset : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Bulk calendar sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
