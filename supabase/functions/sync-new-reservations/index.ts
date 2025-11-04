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
  };
}

async function getGuestyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000; // 2s
  const MAX_BACKOFF_MS = 30000; // 30s
  const MAX_WAIT_TIME_MS = 45000; // 45s to avoid 60s edge timeout

  console.log('Exchanging client credentials for access token...');
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
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

      if (response.ok) {
        const data = await response.json();
        console.log('Successfully obtained access token');
        return data.access_token;
      }

      const text = await response.text();
      const status = response.status;
      console.warn(`Token fetch failed (status ${status}) on attempt ${attempt}: ${text}`);

      // Retry on 429 or 5xx
      if (status === 429 || status >= 500) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = parseRetryAfter(retryAfterHeader);
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        const waitMs = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitMs > MAX_WAIT_TIME_MS) {
          throw new Error('Guesty authentication is rate-limited. Please try again in a minute.');
        }

        console.log(`Retrying token fetch in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      // Non-retryable error
      throw new Error(`Authentication failed: ${status} - ${text}`);
    } catch (err: any) {
      if (attempt >= MAX_RETRIES || Date.now() - start > MAX_WAIT_TIME_MS) {
        console.error('Token fetch failed after retries:', err?.message || err);
        throw new Error('Authentication failed due to temporary service issues. Please try again later.');
      }
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      console.log(`Network error getting token. Retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  throw new Error('Unable to authenticate with Guesty after multiple attempts.');
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

async function fetchGuestyData(apiToken: string, endpoint: string, params: any = {}) {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000;
  const MAX_BACKOFF_MS = 30000;
  const MAX_WAIT_TIME_MS = 45000;
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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

      // Log rate limit headers for monitoring
      const rls = {
        sec: response.headers.get('x-ratelimit-remaining-second'),
        min: response.headers.get('x-ratelimit-remaining-minute'),
        hr: response.headers.get('x-ratelimit-remaining-hour'),
      };
      console.log(`Guesty rate limits remaining - s:${rls.sec} m:${rls.min} h:${rls.hr}`);

      if (response.ok) {
        return await response.json();
      }

      const status = response.status;
      const text = await response.text();
      console.warn(`Guesty API error (${status}) on attempt ${attempt}: ${text}`);

      if (status === 429 || status >= 500) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = parseRetryAfter(retryAfterHeader);
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        const waitMs = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitMs > MAX_WAIT_TIME_MS) {
          throw new Error('Guesty API is rate-limited or temporarily unavailable. Please try again shortly.');
        }

        console.log(`Retrying Guesty request in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      // Non-retryable
      throw new Error(`Guesty API error: ${status} - ${text}`);
    } catch (err: any) {
      if (attempt >= MAX_RETRIES || Date.now() - start > MAX_WAIT_TIME_MS) {
        console.error('Guesty request failed after retries:', err?.message || err);
        throw new Error(err?.message || 'Guesty API request failed');
      }
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      console.log(`Network error calling Guesty. Retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  throw new Error('Guesty API request failed after multiple attempts');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accountId } = await req.json();

    if (!accountId) {
      throw new Error('Missing accountId parameter');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting incremental reservation sync for account ${accountId}`);

    // Get Guesty account credentials
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret, organization_id')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    // Find the most recent imported_at timestamp
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

    // If no reservations exist, direct user to do initial sync
    if (!mostRecentReservation) {
      console.log('No existing reservations found. Initial sync required.');
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

    // Get Guesty access token
    const apiToken = await getGuestyAccessToken(account.client_id, account.client_secret);

    // Fetch reservations updated since cutoff date
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

    console.log('Fetching new/updated reservations from Guesty...');

    while (true) {
      console.log(`Fetching: skip=${skip}, limit=${limit}`);
      
      const data = await fetchGuestyData(apiToken, 'reservations', {
        limit,
        skip,
        filters,
        fields: '_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue',
      });

      const reservations = data.results || [];
      allReservations.push(...reservations);
      
      console.log(`Fetched ${reservations.length} reservations (total: ${allReservations.length})`);

      if (reservations.length < limit) {
        break;
      }

      skip += limit;
      await sleep(500); // Rate limiting
    }

    console.log(`Found ${allReservations.length} new/updated reservations`);

    // Transform and upsert reservations
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
        source: reservation.source,
        confirmation_code: reservation.confirmationCode,
        created_at_guesty: reservation.createdAt,
        last_updated_at_guesty: reservation.lastUpdatedAt,
        updated_at: new Date().toISOString(),
      }));

      // Get all valid listing IDs from database
      console.log('Fetching valid listing IDs...');
      const { data: validListings, error: listingsError } = await supabase
        .from('listings')
        .select('id')
        .eq('guesty_account_id', accountId);

      if (listingsError) {
        console.error('Error fetching valid listings:', listingsError);
        throw listingsError;
      }

      const validListingIds = new Set(validListings?.map(l => l.id) || []);
      console.log(`Found ${validListingIds.size} valid listings in database`);

      // Filter reservations to only include those with valid listings
      const validReservations = reservationsToUpsert.filter(r => {
        const isValid = validListingIds.has(r.listing_id);
        if (!isValid) {
          console.warn(`Skipping reservation ${r.id} - listing ${r.listing_id} not found in database`);
        }
        return isValid;
      });

      console.log(`Filtered to ${validReservations.length} reservations with valid listings (${reservationsToUpsert.length - validReservations.length} skipped)`);

      // Deduplicate by ID
      const uniqueReservations = Array.from(
        new Map(validReservations.map(item => [item.id, item])).values()
      );

      console.log(`Upserting ${uniqueReservations.length} unique reservations...`);

      const { error: upsertError } = await supabase
        .from('reservations')
        .upsert(uniqueReservations, { onConflict: 'id' });

      if (upsertError) {
        console.error('Error upserting reservations:', upsertError);
        throw upsertError;
      }

      console.log('Upsert successful');
      console.log('Nightly allocations will be handled automatically by database trigger');
    }

    // Update last_reservations_sync timestamp
    const syncTimestamp = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('guesty_accounts')
      .update({ last_reservations_sync: syncTimestamp })
      .eq('id', accountId);

    if (updateError) {
      console.error('Error updating last_reservations_sync:', updateError);
    }

    console.log(`Incremental sync completed. ${allReservations.length} reservations processed.`);

    return new Response(
      JSON.stringify({
        success: true,
        newOrUpdatedCount: allReservations.length,
        lastSyncDate: syncTimestamp,
        cutoffDate: cutoffDate.toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error in sync-new-reservations:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
