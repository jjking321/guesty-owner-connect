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
  console.log('Exchanging client credentials for access token...');
  
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
    console.error(`Failed to get access token (${response.status}):`, error);
    throw new Error(`Authentication failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log('Successfully obtained access token');
  return data.access_token;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGuestyData(apiToken: string, endpoint: string, params: any = {}) {
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

  if (!response.ok) {
    const error = await response.text();
    console.error(`Guesty API error (${response.status}):`, error);
    throw new Error(`Guesty API error: ${response.status} - ${error}`);
  }

  return await response.json();
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
      await sleep(350); // Rate limiting
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
