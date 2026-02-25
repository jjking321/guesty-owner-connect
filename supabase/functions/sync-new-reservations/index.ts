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
    subTotal?: number;
  };
}

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

async function fetchGuestyData(apiToken: string, endpoint: string, params: any = {}) {
  const MAX_DATA_RETRIES = 5;
  const BASE_DELAY_MS = 2000;
  const MAX_BACKOFF_MS = 30000;
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_DATA_RETRIES; attempt++) {
    try {
      const url = new URL(`https://open-api.guesty.com/v1/${endpoint}`);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.append(key, params[key].toString());
        }
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      const rls = {
        sec: parseInt(response.headers.get('x-ratelimit-remaining-second') || '999'),
        min: parseInt(response.headers.get('x-ratelimit-remaining-minute') || '999'),
        hr: parseInt(response.headers.get('x-ratelimit-remaining-hour') || '999'),
      };
      console.log(`Guesty rate limits remaining - s:${rls.sec} m:${rls.min} h:${rls.hr}`);

      if (response.ok) {
        return { data: await response.json(), rateLimits: rls };
      }

      const status = response.status;
      const text = await response.text();
      console.warn(`Guesty API error (${status}) on attempt ${attempt}: ${text}`);

      if (status === 429 || status === 502 || status === 503 || status === 504) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        const waitMs = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitMs > MAX_WAIT_TIME) {
          if (status === 429) {
            throw new Error(`Guesty API rate limit reached. Please wait a moment before trying again.`);
          }
          throw new Error(`Guesty API temporarily unavailable (${status}). Please try again.`);
        }

        console.log(`Retrying Guesty request in ${waitMs}ms (attempt ${attempt}/${MAX_DATA_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Guesty API error: ${status} - ${text}`);
    } catch (err: any) {
      if (attempt >= MAX_DATA_RETRIES || Date.now() - start > MAX_WAIT_TIME) {
        throw new Error(err?.message || 'Guesty API request failed');
      }
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      console.log(`Network error calling Guesty. Retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  throw new Error('Guesty API request failed after multiple attempts');
}

function getAdaptiveDelay(rateLimits: { sec: number; min: number; hr: number }): number {
  if (rateLimits.sec < 3) return 1500;
  if (rateLimits.sec < 5) return 1000;
  if (rateLimits.min < 10) return 750;
  return 500;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let supabase: any;
  let syncJobId: string | undefined;

  try {
    const { accountId } = await req.json();

    if (!accountId) {
      throw new Error('Missing accountId parameter');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting incremental reservation sync for account ${accountId}`);

    const { data: syncJobData, error: jobCreateError } = await supabase
      .from('sync_jobs')
      .insert({
        guesty_account_id: accountId,
        sync_type: 'new_reservations',
        status: 'running',
        progress_message: 'Initializing incremental sync...',
        items_synced: 0,
      })
      .select()
      .single();

    if (jobCreateError) {
      console.error('Error creating sync job:', jobCreateError);
    }

    syncJobId = syncJobData?.id;

    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret, organization_id')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    const { data: mostRecentReservation, error: cutoffError } = await supabase
      .from('reservations')
      .select('imported_at')
      .eq('guesty_account_id', accountId)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cutoffError) {
      console.error('Error fetching cutoff date:', cutoffError);
      throw new Error('Failed to determine sync cutoff date');
    }

    if (!mostRecentReservation) {
      console.log('No existing reservations found. Initial sync required.');
      
      if (syncJobId) {
        await supabase
          .from('sync_jobs')
          .update({
            status: 'failed',
            error_message: 'No existing reservations. Please run initial sync from Settings first.',
            completed_at: new Date().toISOString(),
          })
          .eq('id', syncJobId);
      }
      
      return new Response(
        JSON.stringify({
          error: 'No reservations found. Please perform an initial sync from the Settings page first.',
          requiresInitialSync: true,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const cutoffDate = new Date(mostRecentReservation.imported_at);
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

    if (syncJobId) {
      await supabase
        .from('sync_jobs')
        .update({
          progress_message: `Fetching reservations updated since ${cutoffDate.toLocaleDateString()}...`,
        })
        .eq('id', syncJobId);
    }

    // Use cached token manager
    const apiToken = await getGuestyAccessTokenCached(
      supabase,
      accountId,
      account.client_id,
      account.client_secret
    );

    const filters = JSON.stringify([
      {
        field: 'lastUpdatedAt',
        operator: '$gte',
        value: cutoffDate.toISOString(),
      }
    ]);

    let allReservations: GuestyReservation[] = [];
    let skip = 0;
    const limit = 100;
    let lastRateLimits = { sec: 999, min: 999, hr: 999 };

    console.log('Fetching new/updated reservations from Guesty...');

    while (true) {
      console.log(`Fetching: skip=${skip}, limit=${limit}`);
      
      let pageData;
      const MAX_PAGE_RETRIES = 3;
      
      for (let pageAttempt = 1; pageAttempt <= MAX_PAGE_RETRIES; pageAttempt++) {
        try {
          const result = await fetchGuestyData(apiToken, 'reservations', {
            limit,
            skip,
            filters,
            fields: '_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue money.totalTaxes money.subTotal',
          });
          
          pageData = result.data;
          lastRateLimits = result.rateLimits;
          break;
        } catch (err: any) {
          if (pageAttempt >= MAX_PAGE_RETRIES) {
            console.error(`Failed to fetch page at skip=${skip} after ${MAX_PAGE_RETRIES} attempts`);
            throw err;
          }
          console.warn(`Page fetch failed, retrying (${pageAttempt}/${MAX_PAGE_RETRIES}): ${err.message}`);
          await sleep(2000 * pageAttempt);
        }
      }

      const reservations = pageData.results || [];
      allReservations.push(...reservations);
      
      console.log(`Fetched ${reservations.length} reservations (total: ${allReservations.length})`);

      if (syncJobId) {
        await supabase
          .from('sync_jobs')
          .update({
            items_synced: allReservations.length,
            progress_message: `Fetching reservations... (${allReservations.length} found so far)`,
          })
          .eq('id', syncJobId);
      }

      if (reservations.length < limit) {
        break;
      }

      skip += limit;
      
      const delay = getAdaptiveDelay(lastRateLimits);
      console.log(`Waiting ${delay}ms before next page (rate limits: s:${lastRateLimits.sec} m:${lastRateLimits.min})`);
      await sleep(delay);
    }

    console.log(`Found ${allReservations.length} new/updated reservations`);

    if (syncJobId) {
      await supabase
        .from('sync_jobs')
        .update({
          total_items: allReservations.length,
          progress_message: `Processing ${allReservations.length} reservations...`,
        })
        .eq('id', syncJobId);
    }

    if (allReservations.length > 0) {
      const reservationsToUpsert = allReservations.map((reservation: GuestyReservation) => ({
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
        sub_total: reservation.money?.subTotal,
        source: reservation.source,
        confirmation_code: reservation.confirmationCode,
        created_at_guesty: reservation.createdAt,
        last_updated_at_guesty: reservation.lastUpdatedAt,
        updated_at: new Date().toISOString(),
      }));

      console.log('Fetching valid listing IDs...');
      const { data: validListings, error: listingsError } = await supabase
        .from('listings')
        .select('id')
        .eq('guesty_account_id', accountId);

      if (listingsError) {
        console.error('Error fetching valid listings:', listingsError);
        throw listingsError;
      }

      const validListingIds = new Set(validListings?.map((l: any) => l.id) || []);
      console.log(`Found ${validListingIds.size} valid listings in database`);

      const validReservations = reservationsToUpsert.filter(r => {
        const isValid = validListingIds.has(r.listing_id);
        if (!isValid) {
          console.warn(`Skipping reservation ${r.id} - listing ${r.listing_id} not found in database`);
        }
        return isValid;
      });

      console.log(`Filtered to ${validReservations.length} reservations with valid listings (${reservationsToUpsert.length - validReservations.length} skipped)`);

      const uniqueReservations = Array.from(
        new Map(validReservations.map(item => [item.id, item])).values()
      );

      console.log(`Upserting ${uniqueReservations.length} unique reservations in batches...`);

      // Batch upsert in chunks of 200 to prevent statement timeouts
      const BATCH_SIZE = 200;
      let totalUpserted = 0;

      for (let i = 0; i < uniqueReservations.length; i += BATCH_SIZE) {
        const batch = uniqueReservations.slice(i, i + BATCH_SIZE);
        
        const { error: upsertError } = await supabase
          .from('reservations')
          .upsert(batch, { onConflict: 'id' });

        if (upsertError) {
          console.error(`Batch upsert error at index ${i}:`, upsertError);
          throw upsertError;
        }

        totalUpserted += batch.length;

        // Update progress between batches
        if (syncJobId) {
          await supabase
            .from('sync_jobs')
            .update({
              items_synced: totalUpserted,
              progress_message: `Upserting reservations... (${totalUpserted}/${uniqueReservations.length})`,
            })
            .eq('id', syncJobId);
        }

        // Small delay between batches to avoid overwhelming the database
        if (i + BATCH_SIZE < uniqueReservations.length) {
          await sleep(100);
        }

        console.log(`Batch upserted: ${totalUpserted}/${uniqueReservations.length}`);
      }

      console.log('All batches upserted successfully');
      console.log('Nightly allocations will be handled automatically by database trigger');
      
      if (syncJobId) {
        await supabase
          .from('sync_jobs')
          .update({
            items_synced: uniqueReservations.length,
            progress_message: `Successfully synced ${uniqueReservations.length} reservations`,
          })
          .eq('id', syncJobId);
      }
    }

    const syncTimestamp = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('guesty_accounts')
      .update({ last_reservations_sync: syncTimestamp })
      .eq('id', accountId);

    if (updateError) {
      console.error('Error updating last_reservations_sync:', updateError);
    }

    if (syncJobId) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          progress_message: `Sync completed: ${allReservations.length} reservations processed`,
        })
        .eq('id', syncJobId);
    }

    console.log(`Incremental sync completed successfully. Processed ${allReservations.length} reservations.`);

    return new Response(
      JSON.stringify({
        success: true,
        reservationsCount: allReservations.length,
        syncJobId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error in sync-new-reservations:', error);
    
    if (supabase && syncJobId) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncJobId);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
