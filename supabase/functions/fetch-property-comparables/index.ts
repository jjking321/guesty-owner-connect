import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/search/radius';

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

    const { listing_id, radius_miles = 10, amenities = [], bedrooms = null, offset = 0, page_size = 10 } = await req.json();

    if (!listing_id) {
      throw new Error('listing_id is required');
    }

    console.log(`Fetching comparables for listing: ${listing_id}, radius: ${radius_miles} miles, amenities: ${JSON.stringify(amenities)}, bedrooms: ${bedrooms}, offset: ${offset}, page_size: ${page_size}`);

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

    // Build POST body for radius search
    const requestBody: any = {
      latitude: latitude,
      longitude: longitude,
      radius_miles: parseFloat(radius_miles),
      sort: {
        ttm_revenue: "desc"  // Sort by TTM revenue, highest first
      },
      pagination: {
        page_size: page_size,
        offset: offset
      }
    };

    // Add filters if provided
    if (amenities.length > 0 || bedrooms !== null) {
      requestBody.filter = {};
      
      // Amenities filter - use "all" to require all selected amenities
      if (amenities.length > 0) {
        requestBody.filter.amenities = { all: amenities };
      }
      
      // Bedrooms filter - exact match using 'eq' operator
      if (bedrooms !== null) {
        requestBody.filter.bedrooms = { eq: bedrooms };
      }
    }

    console.log(`Calling Air ROI API (POST): ${AIRROI_API_URL}`);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    // Call Air ROI API with POST
    const airroiResponse = await fetch(AIRROI_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': airroiApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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

    // Handle different response formats - radius endpoint might use 'listings' instead of 'results'
    const resultsArray = airroiData.results || airroiData.listings || [];
    const apiResultCount = resultsArray.length;
    console.log(`Air ROI returned ${apiResultCount} comparables`);

    // Process and upsert comparables - API returns nested structure
    const comparables = resultsArray;
    const upsertData = comparables.map((comp: any) => {
      const listingInfo = comp.listing_info || {};
      const hostInfo = comp.host_info || {};
      const locationInfo = comp.location_info || {};
      const propertyDetails = comp.property_details || {};
      const bookingSettings = comp.booking_settings || {};
      const pricingInfo = comp.pricing_info || {};
      const ratings = comp.ratings || {};
      const perfMetrics = comp.performance_metrics || {};

      return {
        listing_id: listing_id,
        airroi_listing_id: listingInfo.listing_id,
        listing_name: listingInfo.listing_name,
        listing_type: listingInfo.listing_type,
        room_type: listingInfo.room_type,
        cover_photo_url: listingInfo.cover_photo_url,
        host_name: hostInfo.host_name,
        superhost: hostInfo.superhost || false,
        location_info: {
          country: locationInfo.country,
          region: locationInfo.region,
          locality: locationInfo.locality,
          district: locationInfo.district,
          lat: locationInfo.latitude,
          lng: locationInfo.longitude,
        },
        property_details: {
          guests: propertyDetails.guests,
          bedrooms: propertyDetails.bedrooms,
          beds: propertyDetails.beds,
          baths: propertyDetails.baths,
          amenities: propertyDetails.amenities,
        },
        booking_settings: {
          instant_book: bookingSettings.instant_book,
          min_nights: bookingSettings.min_nights,
          cancellation_policy: bookingSettings.cancellation_policy,
        },
        pricing_info: {
          currency: pricingInfo.currency,
          cleaning_fee: pricingInfo.cleaning_fee,
          extra_guest_fee: pricingInfo.extra_guest_fee,
        },
        ratings: {
          num_reviews: ratings.num_reviews,
          rating_overall: ratings.rating_overall,
          rating_accuracy: ratings.rating_accuracy,
          rating_checkin: ratings.rating_checkin,
          rating_cleanliness: ratings.rating_cleanliness,
          rating_communication: ratings.rating_communication,
          rating_location: ratings.rating_location,
          rating_value: ratings.rating_value,
        },
        performance_metrics: {
          ttm_revenue: perfMetrics.ttm_revenue,
          ttm_occupancy: perfMetrics.ttm_occupancy,
          ttm_adr: perfMetrics.ttm_avg_rate,
          ttm_revpar: perfMetrics.ttm_revpar,
          available_days: perfMetrics.ttm_available_days,
          reserved_days: perfMetrics.ttm_days_reserved,
          blocked_days: perfMetrics.ttm_blocked_days,
        },
        fetched_at: new Date().toISOString(),
      };
    });

    if (upsertData.length > 0) {
      // Only delete old comparables on first page (offset === 0)
      if (offset === 0) {
        const { error: deleteError } = await supabase
          .from('property_comparables')
          .delete()
          .eq('listing_id', listing_id)
          .eq('is_selected', false);

        if (deleteError) {
          console.warn('Error deleting old comparables:', deleteError.message);
        }
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
    // Sort by selected first, then by TTM revenue (highest first)
    const { data: allComparables, error: fetchError } = await supabase
      .from('property_comparables')
      .select('*')
      .eq('listing_id', listing_id)
      .order('is_selected', { ascending: false })
      .order('performance_metrics->ttm_revenue', { ascending: false, nullsFirst: false });

    if (fetchError) {
      throw new Error(`Failed to fetch comparables: ${fetchError.message}`);
    }

    console.log(`Returning ${allComparables?.length || 0} total comparables`);

    // Build search params for diagnostic info
    const searchParams = {
      latitude,
      longitude,
      radius_miles,
    };

    return new Response(
      JSON.stringify({
        success: true,
        count: allComparables?.length || 0,
        comparables: allComparables || [],
        searchParams,
        apiResultCount,
        apiResponse: apiResultCount === 0 ? airroiData : undefined,
        pagination: {
          offset: offset,
          page_size: page_size,
          hasMore: apiResultCount === page_size // If we got a full page, there may be more
        }
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
