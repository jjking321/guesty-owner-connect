import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

      console.log(`Fetching calendar data from ${startDate} to ${endDate}...`);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
      });

      const rateLimitSec = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMin = response.headers.get('X-ratelimit-remaining-minute');
      const rateLimitHr = response.headers.get('X-ratelimit-remaining-hour');
      console.log(`Rate limits - sec: ${rateLimitSec}, min: ${rateLimitMin}, hr: ${rateLimitHr}`);

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

      const data = await response.json();
      console.log(`Successfully fetched calendar data`);
      return data;
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.error(`Calendar fetch attempt ${attempt} failed:`, error);
    }
  }
  
  throw new Error('Failed to fetch calendar data after retries');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId } = await req.json();
    
    if (!listingId) {
      return new Response(
        JSON.stringify({ error: 'listingId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting calendar sync for listing: ${listingId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('guesty_account_id')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      console.error('Listing not found:', listingError);
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: creds, error: credsError } = await supabase
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', listing.guesty_account_id)
      .single();

    if (credsError || !creds) {
      console.error('Guesty account credentials not found:', credsError);
      return new Response(
        JSON.stringify({ error: 'Guesty account not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use cached token manager
    const accessToken = await getGuestyAccessTokenCached(
      supabase,
      listing.guesty_account_id,
      creds.client_id,
      creds.client_secret
    );

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 365);
    
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const calendarData = await fetchCalendarData(accessToken, listingId, startDateStr, endDateStr);

    console.log('Calendar API response keys:', Object.keys(calendarData));

    const calendarRecords: any[] = [];
    const syncedAt = new Date().toISOString();

    // Handle different response formats
    if (Array.isArray(calendarData)) {
      console.log(`Processing array format with ${calendarData.length} days`);
      for (const day of calendarData) {
        if (day.listingId === listingId || !day.listingId) {
          calendarRecords.push({
            listing_id: listingId,
            date: day.date,
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
        }
      }
    } else if (calendarData.data && calendarData.data.days && Array.isArray(calendarData.data.days)) {
      console.log(`Processing data.days array format with ${calendarData.data.days.length} days`);
      for (const day of calendarData.data.days) {
        calendarRecords.push({
          listing_id: listingId,
          date: day.date,
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
      }
    } else if (calendarData.data && Array.isArray(calendarData.data)) {
      console.log(`Processing data array format with ${calendarData.data.length} days`);
      for (const day of calendarData.data) {
        calendarRecords.push({
          listing_id: listingId,
          date: day.date,
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
      }
    } else if (calendarData.data && calendarData.data[listingId] && calendarData.data[listingId].days) {
      const days = calendarData.data[listingId].days;
      console.log(`Processing nested format with ${Object.keys(days).length} days`);
      for (const [dateStr, dayData] of Object.entries(days)) {
        const day = dayData as any;
        calendarRecords.push({
          listing_id: listingId,
          date: dateStr,
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
      }
    } else if (calendarData[listingId]) {
      const listingData = calendarData[listingId];
      if (Array.isArray(listingData)) {
        console.log(`Processing direct listing array format with ${listingData.length} days`);
        for (const day of listingData) {
          calendarRecords.push({
            listing_id: listingId,
            date: day.date,
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
        }
      } else if (listingData.days) {
        console.log(`Processing direct listing days format`);
        for (const [dateStr, dayData] of Object.entries(listingData.days)) {
          const day = dayData as any;
          calendarRecords.push({
            listing_id: listingId,
            date: dateStr,
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
        }
      }
    } else {
      console.log('Unknown response format, dumping full structure:', JSON.stringify(calendarData).substring(0, 1000));
    }

    console.log(`Processing ${calendarRecords.length} calendar days...`);

    const batchSize = 100;
    let upsertedCount = 0;
    
    for (let i = 0; i < calendarRecords.length; i += batchSize) {
      const batch = calendarRecords.slice(i, i + batchSize);
      
      const { error: upsertError } = await supabase
        .from('capacity_calendar')
        .upsert(batch, { 
          onConflict: 'listing_id,date',
          ignoreDuplicates: false 
        });
      
      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw upsertError;
      }
      
      upsertedCount += batch.length;
      console.log(`Upserted ${upsertedCount}/${calendarRecords.length} calendar days`);
      
      if (i + batchSize < calendarRecords.length) {
        await sleep(100);
      }
    }

    console.log(`Calendar sync complete. ${upsertedCount} days updated.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Synced ${upsertedCount} calendar days`,
        daysUpdated: upsertedCount,
        dateRange: { start: startDateStr, end: endDateStr }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Calendar sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to sync calendar';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
