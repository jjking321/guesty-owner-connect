import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/search/radius';
const MIN_CACHED_THRESHOLD = 5; // Fetch from API if less than this many cached comps

// Haversine formula to calculate distance in miles
function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Score a comparable based on multiple criteria
function scoreComparable(
  comparable: any,
  targetBedrooms: number,
  targetLat: number,
  targetLng: number,
  targetRevenue: number | null
): number {
  let score = 0;

  // 1. Bedroom Match (max 30 points)
  const compBedrooms = comparable.property_details?.bedrooms;
  if (compBedrooms !== null && compBedrooms !== undefined) {
    if (compBedrooms === targetBedrooms) {
      score += 30;
    } else if (Math.abs(compBedrooms - targetBedrooms) === 1) {
      score += 15;
    }
  }

  // 2. Location Proximity (max 30 points)
  const compLat = comparable.location_info?.lat;
  const compLng = comparable.location_info?.lng;
  if (compLat && compLng) {
    const distance = calculateDistanceMiles(targetLat, targetLng, compLat, compLng);
    if (distance <= 0.25) {
      score += 30;
    } else if (distance <= 0.5) {
      score += 20;
    } else if (distance <= 1) {
      score += 10;
    }
  }

  // 3. Revenue Similarity (max 20 points)
  const compRevenue = comparable.ttm_revenue || comparable.performance_metrics?.ttm_revenue;
  if (targetRevenue && compRevenue) {
    const revenueDiff = Math.abs(compRevenue - targetRevenue) / targetRevenue;
    if (revenueDiff <= 0.3) {
      score += 20;
    } else if (revenueDiff <= 0.5) {
      score += 10;
    }
  }

  // 4. Review Quality (max 5 points)
  const rating = comparable.ratings?.rating_overall;
  if (rating && rating >= 4.5) {
    score += 5;
  }

  return score;
}

// Fetch comparables from Air ROI API and cache them
async function fetchFromAirROI(
  supabase: any,
  airroiApiKey: string,
  listingId: string,
  targetLat: number,
  targetLng: number,
  targetBedrooms: number
): Promise<any[]> {
  console.log(`Fetching from Air ROI for listing ${listingId}...`);

  const requestBody: any = {
    latitude: targetLat,
    longitude: targetLng,
    radius_miles: 1, // Tight radius for best matches
    sort: { ttm_revenue: "desc" },
    pagination: { page_size: 25, offset: 0 },
    filter: {
      bedrooms: { range: [Math.max(0, targetBedrooms - 1), targetBedrooms + 1] },
      ttm_revenue: { range: [1000, 10000000] } // Filter out zero performers
    }
  };

  console.log(`Air ROI request body:`, JSON.stringify(requestBody));

  const airroiResponse = await fetch(AIRROI_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': airroiApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!airroiResponse.ok) {
    const errorText = await airroiResponse.text();
    console.error(`Air ROI API error for ${listingId}:`, airroiResponse.status, errorText);
    throw new Error(`Air ROI API error: ${airroiResponse.status}`);
  }

  const responseText = await airroiResponse.text();
  
  // Pre-process to handle BigInt listing IDs
  const processedText = responseText.replace(
    /"listing_id"\s*:\s*(\d{16,})/g,
    '"listing_id": "$1"'
  );
  
  const airroiData = JSON.parse(processedText);
  const resultsArray = airroiData.results || airroiData.listings || [];
  
  console.log(`Air ROI returned ${resultsArray.length} comparables for ${listingId}`);

  if (resultsArray.length === 0) {
    return [];
  }

  // Process and upsert comparables
  const upsertData = resultsArray.map((comp: any) => {
    const listingInfo = comp.listing_info || {};
    const hostInfo = comp.host_info || {};
    const locationInfo = comp.location_info || {};
    const propertyDetails = comp.property_details || {};
    const bookingSettings = comp.booking_settings || {};
    const pricingInfo = comp.pricing_info || {};
    const ratings = comp.ratings || {};
    const perfMetrics = comp.performance_metrics || {};

    return {
      listing_id: listingId,
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

  // Delete old non-selected comparables and upsert new ones
  await supabase
    .from('property_comparables')
    .delete()
    .eq('listing_id', listingId)
    .eq('is_selected', false);

  const { error: upsertError } = await supabase
    .from('property_comparables')
    .upsert(upsertData, {
      onConflict: 'listing_id,airroi_listing_id',
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error(`Upsert error for ${listingId}:`, upsertError);
    throw new Error(`Failed to save comparables: ${upsertError.message}`);
  }

  // Fetch the cached comparables back
  const { data: cachedComps } = await supabase
    .from('property_comparables')
    .select('*')
    .eq('listing_id', listingId);

  return cachedComps || [];
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const airroiApiKey = (Deno.env.get('AIRROI_API_KEY') ?? '').trim();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listing_ids, max_selections = 5 } = await req.json();

    if (!listing_ids || !Array.isArray(listing_ids) || listing_ids.length === 0) {
      throw new Error('listing_ids must be a non-empty array');
    }

    console.log(`AI-selecting top ${max_selections} comparables for ${listing_ids.length} listings`);

    const results: { 
      listing_id: string; 
      selected: number; 
      fetched_from_api: boolean;
      cached_count: number;
      source: string;
      error?: string;
    }[] = [];
    
    let apiCallsMade = 0;

    for (let i = 0; i < listing_ids.length; i++) {
      const listingId = listing_ids[i];
      
      try {
        // 1. Fetch the target listing's details
        const { data: listing, error: listingError } = await supabase
          .from('listings')
          .select('id, address, bedrooms')
          .eq('id', listingId)
          .single();

        if (listingError || !listing) {
          console.warn(`Listing ${listingId} not found, skipping`);
          results.push({ 
            listing_id: listingId, 
            selected: 0, 
            fetched_from_api: false,
            cached_count: 0,
            source: 'error',
            error: 'Listing not found'
          });
          continue;
        }

        const address = listing.address as any;
        const targetLat = address?.lat;
        const targetLng = address?.lng;
        const targetBedrooms = listing.bedrooms || 0;

        if (!targetLat || !targetLng) {
          console.warn(`Listing ${listingId} has no coordinates, skipping`);
          results.push({ 
            listing_id: listingId, 
            selected: 0, 
            fetched_from_api: false,
            cached_count: 0,
            source: 'error',
            error: 'No coordinates'
          });
          continue;
        }

        // 2. Get TTM revenue estimate for the property
        const { data: revData } = await supabase
          .from('reservation_nights')
          .select('revenue_allocation')
          .eq('listing_id', listingId)
          .gte('night_date', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        
        const targetRevenue = revData?.reduce((sum, r) => sum + (r.revenue_allocation || 0), 0) || null;

        // 3. Fetch cached comparables
        let { data: comparables, error: compError } = await supabase
          .from('property_comparables')
          .select('*')
          .eq('listing_id', listingId);

        let fetchedFromApi = false;
        
        // 4. If insufficient cached comps, fetch from Air ROI
        if (!comparables || comparables.length < MIN_CACHED_THRESHOLD) {
          if (!airroiApiKey) {
            console.warn(`No AIRROI_API_KEY, cannot fetch for ${listingId}`);
            results.push({ 
              listing_id: listingId, 
              selected: 0, 
              fetched_from_api: false,
              cached_count: comparables?.length || 0,
              source: 'error',
              error: 'AIRROI_API_KEY not configured'
            });
            continue;
          }

          console.log(`Insufficient cached comps (${comparables?.length || 0}) for ${listingId}, fetching from Air ROI...`);
          
          // Add delay between API calls to respect rate limits
          if (apiCallsMade > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          try {
            comparables = await fetchFromAirROI(
              supabase,
              airroiApiKey,
              listingId,
              targetLat,
              targetLng,
              targetBedrooms
            );
            fetchedFromApi = true;
            apiCallsMade++;
          } catch (apiError: any) {
            console.error(`Failed to fetch from Air ROI for ${listingId}:`, apiError.message);
            results.push({ 
              listing_id: listingId, 
              selected: 0, 
              fetched_from_api: false,
              cached_count: 0,
              source: 'error',
              error: `API fetch failed: ${apiError.message}`
            });
            continue;
          }
        }

        if (!comparables || comparables.length === 0) {
          console.warn(`No comparables available for ${listingId}`);
          results.push({ 
            listing_id: listingId, 
            selected: 0, 
            fetched_from_api: fetchedFromApi,
            cached_count: 0,
            source: fetchedFromApi ? 'air_roi' : 'cache'
          });
          continue;
        }

        // 5. Score and sort comparables
        const scoredComparables = comparables.map((comp) => ({
          ...comp,
          ai_score: scoreComparable(comp, targetBedrooms, targetLat, targetLng, targetRevenue),
        }));

        scoredComparables.sort((a, b) => b.ai_score - a.ai_score);
        const topIds = scoredComparables.slice(0, max_selections).map(c => c.id);

        // 6. Update selection status - deselect all first, then select top N
        await supabase
          .from('property_comparables')
          .update({ is_selected: false, selected_at: null })
          .eq('listing_id', listingId);

        const { error: selectError } = await supabase
          .from('property_comparables')
          .update({ is_selected: true, selected_at: new Date().toISOString() })
          .in('id', topIds);

        if (selectError) {
          console.error(`Error selecting comparables for ${listingId}:`, selectError);
          results.push({ 
            listing_id: listingId, 
            selected: 0, 
            fetched_from_api: fetchedFromApi,
            cached_count: comparables.length,
            source: fetchedFromApi ? 'air_roi' : 'cache',
            error: 'Selection update failed'
          });
        } else {
          results.push({ 
            listing_id: listingId, 
            selected: topIds.length, 
            fetched_from_api: fetchedFromApi,
            cached_count: comparables.length,
            source: fetchedFromApi ? 'air_roi' : 'cache'
          });
          console.log(`Selected ${topIds.length} comparables for ${listingId} (source: ${fetchedFromApi ? 'air_roi' : 'cache'})`);
        }
      } catch (propError: any) {
        console.error(`Error processing ${listingId}:`, propError);
        results.push({ 
          listing_id: listingId, 
          selected: 0, 
          fetched_from_api: false,
          cached_count: 0,
          source: 'error',
          error: propError.message
        });
      }
    }

    const totalSelected = results.reduce((sum, r) => sum + r.selected, 0);
    const propertiesFetchedFromApi = results.filter(r => r.fetched_from_api).length;
    const propertiesWithErrors = results.filter(r => r.error).length;

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: {
          total_selected: totalSelected,
          properties_processed: results.length,
          properties_fetched_from_api: propertiesFetchedFromApi,
          api_calls_made: apiCallsMade,
          properties_with_errors: propertiesWithErrors,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in batch-ai-select-comparables:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
