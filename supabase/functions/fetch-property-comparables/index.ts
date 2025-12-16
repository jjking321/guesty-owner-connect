import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/comparables';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const airroiApiKey = Deno.env.get('AIRROI_API_KEY');

    if (!airroiApiKey) {
      throw new Error('AIRROI_API_KEY is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listing_id, baths = 2 } = await req.json();

    if (!listing_id) {
      throw new Error('listing_id is required');
    }

    console.log(`Fetching comparables for listing: ${listing_id}, baths: ${baths}`);

    // Fetch listing details from database
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, address, bedrooms, accommodates')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) {
      throw new Error(`Listing not found: ${listingError?.message || 'No data'}`);
    }

    console.log('Listing data:', JSON.stringify(listing));

    // Extract coordinates from address JSON
    const address = listing.address as any;
    const latitude = address?.lat;
    const longitude = address?.lng;

    if (!latitude || !longitude) {
      throw new Error('Listing does not have valid coordinates (lat/lng)');
    }

    const bedrooms = listing.bedrooms || 2;
    const guests = listing.accommodates || 4;

    console.log(`Calling Air ROI API with: lat=${latitude}, lng=${longitude}, bedrooms=${bedrooms}, baths=${baths}, guests=${guests}`);

    // Build query params
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      bedrooms: bedrooms.toString(),
      baths: baths.toString(),
      guests: guests.toString(),
      currency: 'native',
    });

    // Call Air ROI API
    const airroiResponse = await fetch(`${AIRROI_API_URL}?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': airroiApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!airroiResponse.ok) {
      const errorText = await airroiResponse.text();
      console.error('Air ROI API error:', airroiResponse.status, errorText);
      throw new Error(`Air ROI API error: ${airroiResponse.status} - ${errorText}`);
    }

    const airroiData = await airroiResponse.json();
    console.log(`Air ROI returned ${airroiData.results?.length || 0} comparables`);

    // Process and upsert comparables
    const comparables = airroiData.results || [];
    const upsertData = comparables.map((comp: any) => ({
      listing_id: listing_id,
      airroi_listing_id: comp.listing_id,
      listing_name: comp.listing_name,
      listing_type: comp.listing_type,
      room_type: comp.room_type,
      cover_photo_url: comp.cover_photo_url,
      host_name: comp.host_name,
      superhost: comp.superhost || false,
      location_info: {
        country: comp.country,
        region: comp.region,
        locality: comp.locality,
        district: comp.district,
        lat: comp.lat,
        lng: comp.lng,
      },
      property_details: {
        guests: comp.guests,
        bedrooms: comp.bedrooms,
        beds: comp.beds,
        baths: comp.baths,
        amenities: comp.amenities,
      },
      booking_settings: {
        instant_book: comp.instant_book,
        min_nights: comp.min_nights,
        cancellation_policy: comp.cancellation_policy,
      },
      pricing_info: {
        currency: comp.currency,
        cleaning_fee: comp.cleaning_fee,
        extra_guest_fee: comp.extra_guest_fee,
      },
      ratings: {
        num_reviews: comp.num_reviews,
        rating_overall: comp.rating_overall,
        rating_accuracy: comp.rating_accuracy,
        rating_checkin: comp.rating_checkin,
        rating_cleanliness: comp.rating_cleanliness,
        rating_communication: comp.rating_communication,
        rating_location: comp.rating_location,
        rating_value: comp.rating_value,
      },
      performance_metrics: {
        ttm_revenue: comp.ttm_revenue,
        ttm_occupancy: comp.ttm_occupancy,
        ttm_adr: comp.ttm_adr,
        ttm_revpar: comp.ttm_revpar,
        available_days: comp.available_days,
        reserved_days: comp.reserved_days,
        blocked_days: comp.blocked_days,
      },
      fetched_at: new Date().toISOString(),
      // Keep existing is_selected status if updating
    }));

    if (upsertData.length > 0) {
      // First, delete old comparables that are not selected for this listing
      // to avoid stale data
      const { error: deleteError } = await supabase
        .from('property_comparables')
        .delete()
        .eq('listing_id', listing_id)
        .eq('is_selected', false);

      if (deleteError) {
        console.warn('Error deleting old comparables:', deleteError.message);
      }

      // Upsert new comparables
      const { error: upsertError } = await supabase
        .from('property_comparables')
        .upsert(upsertData, {
          onConflict: 'listing_id,airroi_listing_id',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw new Error(`Failed to save comparables: ${upsertError.message}`);
      }
    }

    // Fetch all comparables for this listing (including previously selected ones)
    const { data: allComparables, error: fetchError } = await supabase
      .from('property_comparables')
      .select('*')
      .eq('listing_id', listing_id)
      .order('is_selected', { ascending: false })
      .order('fetched_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch comparables: ${fetchError.message}`);
    }

    console.log(`Returning ${allComparables?.length || 0} total comparables`);

    return new Response(
      JSON.stringify({
        success: true,
        count: allComparables?.length || 0,
        comparables: allComparables || [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in fetch-property-comparables:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
