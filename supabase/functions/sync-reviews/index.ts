import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const REVIEWS_REQUEST_DELAY_MS = 1000; // 1s between page requests
const LISTING_DELAY_MS = 1500; // 1.5s between listings
const MAX_RETRIES = 5; // Retries on 429 or network failures
const RETRY_BACKOFF_BASE_MS = 2000; // 2s base for exponential backoff

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to fetch a page with simple 429 retry handling (mirrors reservations pattern)
async function fetchReviewsPage(
  accessToken: string,
  listingId: string,
  limit: number,
  skip: number
): Promise<any> {
  let attempt = 0;
  while (true) {
    const url = `https://open-api.guesty.com/v1/reviews?listingId=${listingId}&limit=${limit}&skip=${skip}&sort=createdAt`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
      },
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const wait = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt); // 2s, 4s, 8s, ...
      console.log(`Rate limited (429) for listing ${listingId} skip=${skip}. Waiting ${wait}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
      await delay(wait);
      attempt++;
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch reviews (${response.status} ${response.statusText}): ${body}`);
    }

    return await response.json();
  }
}

interface GuestyReview {
  _id: string;
  listingId: string;
  reservationId?: string;
  guestName: string;
  rating: number;
  review?: string;
  publicReply?: string;
  createdAt: string;
  source: string;
  categories?: Record<string, number>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { guestyAccountId, listingId } = await req.json();

    if (!guestyAccountId) {
      throw new Error('Guesty account ID is required');
    }

    console.log('Starting review sync for account:', guestyAccountId);

    // Get Guesty account credentials
    const { data: guestyAccount, error: accountError } = await supabaseClient
      .from('guesty_accounts')
      .select('*')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !guestyAccount) {
      throw new Error('Guesty account not found');
    }

    // Create sync job
    const { data: syncJob, error: syncJobError } = await supabaseClient
      .from('sync_jobs')
      .insert({
        guesty_account_id: guestyAccountId,
        sync_type: 'reviews',
        status: 'running',
        progress_message: 'Starting review sync...',
      })
      .select()
      .single();

    if (syncJobError) {
      throw new Error('Failed to create sync job');
    }

    console.log('Sync job created:', syncJob.id);

    // Get Guesty OAuth token
    const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: guestyAccount.client_id,
        client_secret: guestyAccount.client_secret,
        scope: 'open-api',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Failed to get Guesty token: ${tokenResponse.statusText}`);
    }

    const { access_token } = await tokenResponse.json();

    // Get listings to sync reviews for
    let listingsToSync: string[] = [];
    if (listingId) {
      listingsToSync = [listingId];
    } else {
      const { data: listings } = await supabaseClient
        .from('listings')
        .select('id')
        .eq('guesty_account_id', guestyAccountId);
      
      listingsToSync = listings?.map(l => l.id) || [];
    }

    console.log(`Syncing reviews for ${listingsToSync.length} listings`);

    let totalSynced = 0;
    let totalFailed = 0;
    const failedListings: string[] = [];

// Process listings serially to align with reservations sync pattern
for (let i = 0; i < listingsToSync.length; i++) {
  const currentListingId = listingsToSync[i];
  try {
    let skip = 0;
    const limit = 100;
    let hasMore = true;
    let listingSynced = 0;

    while (hasMore) {
      // Small delay between page requests
      await delay(REVIEWS_REQUEST_DELAY_MS);

      let data: any;
      try {
        data = await fetchReviewsPage(access_token, currentListingId, limit, skip);
      } catch (err) {
        console.error(`Error fetching reviews for listing ${currentListingId} (skip=${skip}):`, err);
        failedListings.push(currentListingId);
        totalFailed++;
        break; // move to next listing
      }

      const results = data?.results ?? [];
      if (results.length === 0) {
        hasMore = false;
        break;
      }

      // Upsert reviews
      const reviewsToInsert = results.map((review: GuestyReview) => ({
        id: review._id,
        guesty_account_id: guestyAccountId,
        listing_id: review.listingId,
        reservation_id: review.reservationId || null,
        guest_name: review.guestName || 'Anonymous',
        rating: review.rating,
        review_text: review.review || null,
        response_text: review.publicReply || null,
        review_date: review.createdAt,
        source: review.source || 'unknown',
        category_ratings: review.categories || null,
      }));

      const { error: upsertError } = await supabaseClient
        .from('reviews')
        .upsert(reviewsToInsert, { onConflict: 'id' });

      if (upsertError) {
        console.error('Error upserting reviews:', upsertError);
        totalFailed += results.length;
      } else {
        listingSynced += results.length;
        totalSynced += results.length;
      }

      skip += limit;
      if (results.length < limit) {
        hasMore = false;
      }
    }

    if (listingSynced > 0) {
      console.log(`Synced ${listingSynced} reviews for listing ${currentListingId}`);
    }

    // Update progress after each listing
    await supabaseClient
      .from('sync_jobs')
      .update({
        items_synced: totalSynced,
        progress_message: `Synced ${totalSynced} reviews from ${i + 1}/${listingsToSync.length} listings...`,
      })
      .eq('id', syncJob.id);

  } catch (error) {
    console.error(`Error syncing reviews for listing ${currentListingId}:`, error);
    if (!failedListings.includes(currentListingId)) {
      failedListings.push(currentListingId);
      totalFailed++;
    }
  }

  // Wait a bit between listings to avoid global rate limiting
  if (i < listingsToSync.length - 1) {
    await delay(LISTING_DELAY_MS);
  }
}

    // Update sync job completion
    const statusMessage = failedListings.length > 0
      ? `Synced ${totalSynced} reviews successfully. ${failedListings.length} listings failed.`
      : `Synced ${totalSynced} reviews successfully`;

    await supabaseClient
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_synced: totalSynced,
        progress_message: statusMessage,
      })
      .eq('id', syncJob.id);

    // Update last sync timestamp
    await supabaseClient
      .from('guesty_accounts')
      .update({ last_reviews_sync: new Date().toISOString() })
      .eq('id', guestyAccountId);

    console.log(`Review sync completed. Synced: ${totalSynced}, Failed: ${totalFailed}`);
    if (failedListings.length > 0) {
      console.log(`Failed listings: ${failedListings.join(', ')}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: totalSynced,
        failed: totalFailed,
        message: `Successfully synced ${totalSynced} reviews`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in sync-reviews function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
