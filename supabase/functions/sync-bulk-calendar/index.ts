import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 50;
const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000;
const TOKEN_BUFFER_MS = 120000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 1000;
const LOCK_MAX_POLLS = 6;

async function sleep(ms: number) {
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
      await sleep(LOCK_POLL_INTERVAL_MS);
      
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
        await sleep(waitTime);
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
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }
  
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3 minutes.');
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
  authToken: string,
  guestyToken?: string
) {
  console.log(`Starting bulk calendar sync for account ${guestyAccountId}, resuming from offset ${resumeFromOffset}`);

  try {
    const { data: creds, error: credsError } = await supabase
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', guestyAccountId)
      .single();

    if (credsError || !creds) {
      throw new Error('Guesty account credentials not found');
    }

    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('guesty_account_id', guestyAccountId)
      .eq('is_listed', true)
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

    await supabase.from('sync_jobs').update({
      total_items: listings.length,
      progress_message: `Starting sync of ${listings.length} listings...`,
    }).eq('id', syncJobId);

    // Use provided token or get from cache
    let accessToken: string;
    if (guestyToken) {
      console.log('Reusing Guesty token from previous batch');
      accessToken = guestyToken;
    } else {
      console.log('Getting access token (with caching)...');
      accessToken = await getGuestyAccessTokenCached(
        supabase,
        guestyAccountId,
        creds.client_id,
        creds.client_secret
      );
    }

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 365);
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const syncedAt = new Date().toISOString();

    let totalDaysSynced = 0;

    for (let i = resumeFromOffset; i < listings.length; i++) {
      const listing = listings[i];
      
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
        const calendarData = await fetchCalendarData(accessToken, listing.id, startDateStr, endDateStr);
        const records = processCalendarData(calendarData, listing.id, syncedAt);
        
        if (records.length > 0) {
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

        await supabase.from('sync_jobs').update({
          items_synced: i + 1,
          last_synced_offset: i,
          progress_message: `Synced ${listing.nickname || listing.id} (${i + 1}/${listings.length}) - ${records.length} days`,
        }).eq('id', syncJobId);

      } catch (listingError: any) {
        console.error(`Error syncing listing ${listing.id}:`, listingError.message);
      }

      await sleep(500);

      const itemsProcessedThisBatch = i - resumeFromOffset + 1;
      if (itemsProcessedThisBatch >= BATCH_SIZE && i < listings.length - 1) {
        await supabase.from('sync_jobs').update({
          items_synced: i + 1,
          last_synced_offset: i,
          progress_message: `Processed ${i + 1}/${listings.length} listings. Continuing in next batch...`,
        }).eq('id', syncJobId);

        console.log(`Batch of ${BATCH_SIZE} complete at listing ${i + 1}. Self-invoking for continuation...`);

        // Pass the cached token to avoid new OAuth request
        // IMPORTANT: do not pass `headers` to functions.invoke (it replaces default headers and can drop apikey/authorization)
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        const invokeClient = createClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { 'x-service-role': 'true' } },
        });

        const { error: invokeError } = await invokeClient.functions.invoke('sync-bulk-calendar', {
          body: { guestyAccountId, guestyToken: accessToken },
        });

        if (invokeError) {
          console.error('Self-invocation failed:', invokeError);
        }

        return;
      }
    }

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

addEventListener('beforeunload', (ev: any) => {
  console.log('Function shutdown due to:', ev.detail?.reason);
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for service role invocation FIRST (from nightly-sync or self-invocation)
    const isServiceRole = req.headers.get('x-service-role') === 'true';

    const authHeader = req.headers.get('Authorization');
    let authToken = '';

    if (isServiceRole) {
      console.log('Service role invocation detected - bypassing user auth');
      // For service role, we don't need an auth token since we use service role key
      authToken = 'service-role';
    } else {
      // Only require Authorization header for non-service-role calls
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      authToken = authHeader.replace('Bearer ', '');

      // Validate user auth for direct user calls
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
      console.log(`User authenticated: ${user.id}`);
    }

    const { guestyAccountId, guestyToken } = await req.json();
    
    if (!guestyAccountId) {
      return new Response(
        JSON.stringify({ error: 'guestyAccountId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Bulk calendar sync requested for account: ${guestyAccountId}`);

    const { data: runningJob } = await supabase
      .from('sync_jobs')
      .select('*')
      .eq('guesty_account_id', guestyAccountId)
      .eq('sync_type', 'capacity_calendar')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let syncJobId: string;
    let resumeFromOffset = 0;
    let isResuming = false;

    if (runningJob) {
      syncJobId = runningJob.id;
      resumeFromOffset = (runningJob.last_synced_offset || 0) + 1;
      isResuming = true;
      console.log(`Resuming running job ${syncJobId} from offset ${resumeFromOffset}`);
    } else {
      // If user clicked “Resume”, the latest job is typically FAILED with last_synced_offset > 0.
      const { data: failedJob } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', guestyAccountId)
        .eq('sync_type', 'capacity_calendar')
        .eq('status', 'failed')
        .gt('last_synced_offset', 0)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (failedJob) {
        syncJobId = failedJob.id;
        resumeFromOffset = (failedJob.last_synced_offset || 0) + 1;
        isResuming = true;

        const now = new Date().toISOString();
        const { error: reviveError } = await supabase
          .from('sync_jobs')
          .update({
            status: 'running',
            started_at: now,
            completed_at: null,
            error_message: null,
            progress_message: `Resuming from ${resumeFromOffset}...`,
          })
          .eq('id', syncJobId);

        if (reviveError) {
          throw new Error(`Failed to resume previous job: ${reviveError.message}`);
        }

        console.log(`Resuming failed job ${syncJobId} from offset ${resumeFromOffset}`);
      } else {
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
    }

    EdgeRuntime.waitUntil(performSync(supabase, guestyAccountId, syncJobId, resumeFromOffset, authToken, guestyToken));

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
