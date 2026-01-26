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

// Exact copy from sync-new-reservations - OAuth token fetching with full retry logic
async function getGuestyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const MAX_RETRIES = 10;
  const BASE_DELAY_MS = 2000;
  const MAX_BACKOFF_MS = 30000;
  const MAX_WAIT_TIME_MS = 55000;

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
      console.warn(`Token fetch failed (status ${status}) on attempt ${attempt}/${MAX_RETRIES}: ${text}`);

      if (status === 429 || status >= 500) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = parseRetryAfter(retryAfterHeader);
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        const waitMs = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitMs > MAX_WAIT_TIME_MS) {
          if (status === 429) {
            const estimatedWaitMinutes = Math.max(3, Math.ceil(retryAfterMs / 60000));
            throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${estimatedWaitMinutes} minutes before trying again.`);
          }
          throw new Error(`SERVER_ERROR:Guesty API temporarily unavailable (${status}). Please try again in 2 minutes.`);
        }

        console.log(`Retrying token fetch in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      throw new Error(`AUTH_FAILED:Authentication failed: ${status} - ${text}`);
    } catch (err: any) {
      if (attempt >= MAX_RETRIES || Date.now() - start > MAX_WAIT_TIME_MS) {
        console.error('Token fetch failed after retries:', err?.message || err);
        if (err?.message?.includes(':')) {
          throw err;
        }
        throw new Error('OAUTH_RATE_LIMIT:Authentication failed due to rate limiting. Please wait 3-5 minutes before trying again.');
      }
      const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      console.log(`Network error getting token. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(backoff);
    }
  }

  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3-5 minutes.');
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
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = parseRetryAfter(retryAfterHeader);
        const backoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        const waitMs = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitMs > MAX_WAIT_TIME_MS) {
          const waitMinutes = Math.ceil(retryAfterMs / 60000);
          if (status === 429) {
            throw new Error(`Guesty API rate limit reached. Please wait ${waitMinutes || 1} minute(s) before trying again.`);
          }
          throw new Error(`Guesty API temporarily unavailable (${status}). Please try again in a few moments.`);
        }

        console.log(`Retrying Guesty request in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

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

  try {
    const { listingId } = await req.json();

    if (!listingId) {
      throw new Error('Missing listingId parameter');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting reservation sync for listing ${listingId}`);

    // Get the listing to find the guesty_account_id
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('guesty_account_id')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      throw new Error('Listing not found');
    }

    const accountId = listing.guesty_account_id;

    // Get Guesty account credentials
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    // Get Guesty access token with full retry logic
    const apiToken = await getGuestyAccessToken(account.client_id, account.client_secret);

    // Fetch all reservations for this specific listing
    let allReservations: GuestyReservation[] = [];
    let skip = 0;
    const limit = 100;
    let lastRateLimits = { sec: 999, min: 999, hr: 999 };

    console.log('Fetching reservations from Guesty...');

    while (true) {
      console.log(`Fetching: skip=${skip}, limit=${limit}`);

      const result = await fetchGuestyData(apiToken, 'reservations', {
        limit,
        skip,
        listingId: listingId, // Filter by specific listing
        fields: '_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue',
      });

      const reservations = result.data.results || [];
      allReservations.push(...reservations);
      lastRateLimits = result.rateLimits;

      console.log(`Fetched ${reservations.length} reservations (total: ${allReservations.length})`);

      if (reservations.length < limit) {
        break;
      }

      skip += limit;

      // Adaptive delay based on rate limits
      const delay = getAdaptiveDelay(lastRateLimits);
      console.log(`Waiting ${delay}ms before next page (rate limits: s:${lastRateLimits.sec} m:${lastRateLimits.min})`);
      await sleep(delay);
    }

    console.log(`Found ${allReservations.length} total reservations for listing`);

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

      // Deduplicate by ID
      const uniqueReservations = Array.from(
        new Map(reservationsToUpsert.map(item => [item.id, item])).values()
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

    console.log(`Sync completed. ${allReservations.length} reservations processed.`);

    return new Response(
      JSON.stringify({
        success: true,
        reservationsCount: allReservations.length,
        listingId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error in sync-listing-reservations:', error);

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
