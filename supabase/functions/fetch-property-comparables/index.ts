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
    const bathsFloat = parseFloat(baths).toFixed(1); // Ensure "2.0" not "2"

    // Build query params
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      bedrooms: bedrooms.toString(),
      baths: bathsFloat,
      guests: guests.toString(),
      currency: 'native',
    });

    const fullUrl = `${AIRROI_API_URL}?${params}`;
    console.log(`Full API URL: ${fullUrl}`);

    // Call Air ROI API
    const airroiResponse = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'x-api-key': airroiApiKey,
        'Content-Type': 'application/json',
      },
    });

    // Log response headers for diagnostics
    console.log('Response status:', airroiResponse.status);
    console.log('Response headers:', {
      contentType: airroiResponse.headers.get('content-type'),
      rateLimit: airroiResponse.headers.get('x-ratelimit-remaining'),
      rateLimitReset: airroiResponse.headers.get('x-ratelimit-reset'),
    });

    const responseText = await airroiResponse.text();
    console.log('Raw API response:', responseText);

    if (!airroiResponse.ok) {
      console.error('Air ROI API error:', airroiResponse.status, responseText);
      throw new Error(`Air ROI API error: ${airroiResponse.status} - ${responseText}`);
    }

    let airroiData;
    try {
      airroiData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse API response as JSON:', parseError);
      throw new Error(`Failed to parse Air ROI response: ${responseText.substring(0, 200)}`);
    }

    // Log the full response structure
    console.log('Parsed Air ROI response:', JSON.stringify(airroiData, null, 2));

    // Check for error fields in the response body
    if (airroiData.error) {
      console.error('Air ROI returned error in body:', airroiData.error);
      throw new Error(`Air ROI API error: ${airroiData.error}`);
    }
    if (airroiData.message && !airroiData.results) {
      console.warn('Air ROI returned message:', airroiData.message);
    }

    const apiResultCount = airroiData.results?.length || 0;
    console.log(`Air ROI returned ${apiResultCount} comparables`);

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
    }));

    if (upsertData.length > 0) {
      // First, delete old comparables that are not selected for this listing
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

    // Build search params for diagnostic info
    const searchParams = {
      latitude,
      longitude,
      bedrooms,
      baths: bathsFloat,
      guests,
      currency: 'native',
    };

    return new Response(
      JSON.stringify({
        success: true,
        count: allComparables?.length || 0,
        comparables: allComparables || [],
        searchParams,
        apiResultCount,
        apiResponse: apiResultCount === 0 ? airroiData : undefined, // Include full response if no results
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
