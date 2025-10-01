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
    });

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
  }

  return allListings;
}

async function fetchReservationsByCheckIn(apiToken: string, startDate: string, onProgress?: (fetched: number, total?: number) => Promise<void>) {
  const allReservations: GuestyReservation[] = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    console.log(`Fetching reservations: skip=${skip}, limit=${limit}`);
    
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
    
    if (onProgress) {
      await onProgress(allReservations.length, data.count);
    }
    
    console.log(`Fetched ${reservations.length} reservations`);

    if (reservations.length < limit) {
      break;
    }

    skip += limit;
  }

  return allReservations;
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

    // Sync reservations
    if (syncType === 'reservations' || syncType === 'both') {
      const jobId = await createSyncJob(supabase, accountId, 'reservations');
      
      try {
        const defaultStartDate = startDate || new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        await updateSyncJob(supabase, jobId, { 
          progress_message: `Fetching reservations from Guesty (checkIn >= ${defaultStartDate})...` 
        });

        const guestyReservations = await fetchReservationsByCheckIn(accessToken, defaultStartDate, async (fetched, total) => {
          await updateSyncJob(supabase, jobId, {
            progress_message: `Fetching reservations: ${fetched}${total ? `/${total}` : ''}`,
            items_synced: fetched,
            total_items: total,
          });
        });

        await updateSyncJob(supabase, jobId, { progress_message: 'Saving reservations to database...' });

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
          updated_at: new Date().toISOString(),
        }));

        // Deduplicate reservations by ID (keep last occurrence)
        const uniqueReservations = Array.from(
          new Map(reservationsToUpsert.map(item => [item.id, item])).values()
        );
        
        console.log(`Deduplication: ${reservationsToUpsert.length} -> ${uniqueReservations.length} unique reservations`);

        if (uniqueReservations.length > 0) {
          const { error: reservationsError } = await supabase
            .from('reservations')
            .upsert(uniqueReservations, { onConflict: 'id' });

          if (reservationsError) throw reservationsError;
        }

        reservationsCount = uniqueReservations.length;

        await updateSyncJob(supabase, jobId, {
          status: 'completed',
          progress_message: `Completed: ${reservationsCount} reservations synced`,
          items_synced: reservationsCount,
          completed_at: new Date().toISOString(),
        });

        await supabase
          .from('guesty_accounts')
          .update({ last_reservations_sync: new Date().toISOString() })
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
