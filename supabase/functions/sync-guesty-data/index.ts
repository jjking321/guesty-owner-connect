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
  thumbnail: string;
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

async function fetchGuestyData(apiToken: string, endpoint: string, params: any = {}) {
  const url = new URL(`https://open-api.guesty.com/v1/${endpoint}`);
  
  // Add query parameters
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

async function fetchAllListings(apiToken: string) {
  const allListings: GuestyListing[] = [];
  let skip = 0;
  const limit = 100; // Max limit per Guesty API

  while (true) {
    console.log(`Fetching listings: skip=${skip}, limit=${limit}`);
    const data = await fetchGuestyData(apiToken, 'listings', {
      limit,
      skip,
      fields: '_id createdAt nickname status isListed active propertyType accommodates bedrooms address thumbnail',
    });

    const listings = data.results || [];
    allListings.push(...listings);
    
    console.log(`Fetched ${listings.length} listings`);

    // If we got fewer results than the limit, we've reached the end
    if (listings.length < limit) {
      break;
    }

    skip += limit;
  }

  return allListings;
}

async function fetchReservationsByCheckIn(apiToken: string, startDate: string) {
  const allReservations: GuestyReservation[] = [];
  let skip = 0;
  const limit = 100; // Max limit per Guesty API

  while (true) {
    console.log(`Fetching reservations: skip=${skip}, limit=${limit}`);
    
    // Using filters parameter as per Guesty API docs
    const filters = JSON.stringify([
      {
        field: 'checkIn',
        operator: '$gte',
        value: startDate,
      }
    ]);

    const data = await fetchGuestyData(apiToken, 'reservations', {
      limit,
      skip,
      filters,
      fields: '_id status checkIn checkOut nightsCount guestsCount fareAccommodationAdjusted hostPayout totalPaid ownerRevenue listingId source confirmationCode createdAt lastUpdatedAt',
    });

    const reservations = data.results || [];
    allReservations.push(...reservations);
    
    console.log(`Fetched ${reservations.length} reservations`);

    // If we got fewer results than the limit, we've reached the end
    if (reservations.length < limit) {
      break;
    }

    skip += limit;
  }

  return allReservations;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accountId, startDate } = await req.json();

    if (!accountId) {
      throw new Error('accountId is required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the Guesty account details
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    console.log(`Starting sync for account: ${account.account_name}`);

    // Exchange client credentials for access token
    const accessToken = await getGuestyAccessToken(account.client_id, account.client_secret);

    // Fetch all listings
    console.log('Fetching listings from Guesty...');
    const guestyListings = await fetchAllListings(accessToken);
    console.log(`Fetched ${guestyListings.length} listings from Guesty`);

    // Upsert listings into database
    const listingsToUpsert = guestyListings.map((listing: GuestyListing) => ({
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
      thumbnail: listing.thumbnail,
    }));

    if (listingsToUpsert.length > 0) {
      const { error: listingsError } = await supabase
        .from('listings')
        .upsert(listingsToUpsert, { onConflict: 'id' });

      if (listingsError) {
        console.error('Error upserting listings:', listingsError);
        throw listingsError;
      }
    }

    console.log(`Upserted ${listingsToUpsert.length} listings`);

    // Fetch reservations (filter by checkIn date, default to 2 years ago)
    const defaultStartDate = startDate || new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    console.log(`Fetching reservations from Guesty (checkIn >= ${defaultStartDate})...`);
    const guestyReservations = await fetchReservationsByCheckIn(accessToken, defaultStartDate);
    console.log(`Fetched ${guestyReservations.length} reservations from Guesty`);

    // Upsert reservations into database
    const reservationsToUpsert = guestyReservations.map((reservation: GuestyReservation) => ({
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
    }));

    if (reservationsToUpsert.length > 0) {
      const { error: reservationsError } = await supabase
        .from('reservations')
        .upsert(reservationsToUpsert, { onConflict: 'id' });

      if (reservationsError) {
        console.error('Error upserting reservations:', reservationsError);
        throw reservationsError;
      }
    }

    console.log(`Upserted ${reservationsToUpsert.length} reservations`);

    // Update last sync time
    await supabase
      .from('guesty_accounts')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', accountId);

    console.log('Sync completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        listingsCount: listingsToUpsert.length,
        reservationsCount: reservationsToUpsert.length,
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
