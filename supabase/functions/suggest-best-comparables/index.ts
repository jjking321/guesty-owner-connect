import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  targetRevenue: number | null,
  targetAmenities: string[]
): { score: number; breakdown: Record<string, number> } {
  let score = 0;
  const breakdown: Record<string, number> = {};

  // 1. Bedroom Match (max 30 points)
  const compBedrooms = comparable.property_details?.bedrooms;
  if (compBedrooms !== null && compBedrooms !== undefined) {
    if (compBedrooms === targetBedrooms) {
      breakdown.bedroom_match = 30;
    } else if (Math.abs(compBedrooms - targetBedrooms) === 1) {
      breakdown.bedroom_match = 15;
    } else {
      breakdown.bedroom_match = 0;
    }
  } else {
    breakdown.bedroom_match = 0;
  }
  score += breakdown.bedroom_match;

  // 2. Location Proximity (max 30 points)
  const compLat = comparable.location_info?.lat;
  const compLng = comparable.location_info?.lng;
  if (compLat && compLng) {
    const distance = calculateDistanceMiles(targetLat, targetLng, compLat, compLng);
    if (distance <= 0.25) {
      breakdown.location_proximity = 30;
    } else if (distance <= 0.5) {
      breakdown.location_proximity = 20;
    } else if (distance <= 1) {
      breakdown.location_proximity = 10;
    } else {
      breakdown.location_proximity = 0;
    }
    breakdown.distance_miles = Math.round(distance * 100) / 100;
  } else {
    breakdown.location_proximity = 0;
    breakdown.distance_miles = -1;
  }
  score += breakdown.location_proximity;

  // 3. Revenue Similarity (max 20 points)
  const compRevenue = comparable.ttm_revenue || comparable.performance_metrics?.ttm_revenue;
  if (targetRevenue && compRevenue) {
    const revenueDiff = Math.abs(compRevenue - targetRevenue) / targetRevenue;
    if (revenueDiff <= 0.3) {
      breakdown.revenue_similarity = 20;
    } else if (revenueDiff <= 0.5) {
      breakdown.revenue_similarity = 10;
    } else {
      breakdown.revenue_similarity = 0;
    }
  } else {
    breakdown.revenue_similarity = 0;
  }
  score += breakdown.revenue_similarity;

  // 4. Amenity Overlap (max 15 points)
  const compAmenities = comparable.property_details?.amenities || [];
  if (targetAmenities.length > 0 && compAmenities.length > 0) {
    const overlap = targetAmenities.filter((a: string) => 
      compAmenities.some((ca: string) => ca.toLowerCase() === a.toLowerCase())
    ).length;
    const overlapRate = overlap / targetAmenities.length;
    if (overlapRate >= 0.7) {
      breakdown.amenity_overlap = 15;
    } else if (overlapRate >= 0.5) {
      breakdown.amenity_overlap = 10;
    } else {
      breakdown.amenity_overlap = 0;
    }
  } else {
    breakdown.amenity_overlap = 0;
  }
  score += breakdown.amenity_overlap;

  // 5. Review Quality (max 5 points)
  const rating = comparable.ratings?.rating_overall;
  if (rating && rating >= 4.5) {
    breakdown.review_quality = 5;
  } else {
    breakdown.review_quality = 0;
  }
  score += breakdown.review_quality;

  return { score, breakdown };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listing_id, max_selections = 5 } = await req.json();

    if (!listing_id) {
      throw new Error('listing_id is required');
    }

    console.log(`Suggesting best ${max_selections} comparables for listing: ${listing_id}`);

    // 1. Fetch the target listing's details
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, address, bedrooms, accommodates')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) {
      throw new Error(`Listing not found: ${listingError?.message || 'No data'}`);
    }

    const address = listing.address as any;
    const targetLat = address?.lat;
    const targetLng = address?.lng;
    const targetBedrooms = listing.bedrooms || 0;

    if (!targetLat || !targetLng) {
      throw new Error('Listing does not have valid coordinates');
    }

    console.log(`Target listing: ${targetBedrooms} BR at (${targetLat}, ${targetLng})`);

    // 2. Get the property's TTM revenue for revenue similarity scoring
    // We'll try to get it from reservations or existing forecast
    const { data: revData } = await supabase
      .from('reservation_nights')
      .select('revenue_allocation')
      .eq('listing_id', listing_id)
      .gte('night_date', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    
    const targetRevenue = revData?.reduce((sum, r) => sum + (r.revenue_allocation || 0), 0) || null;
    console.log(`Target listing TTM revenue estimate: ${targetRevenue}`);

    // 3. Fetch all cached comparables for this listing
    const { data: comparables, error: compError } = await supabase
      .from('property_comparables')
      .select('*')
      .eq('listing_id', listing_id);

    if (compError) {
      throw new Error(`Failed to fetch comparables: ${compError.message}`);
    }

    if (!comparables || comparables.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          suggestions: [],
          message: 'No cached comparables found. Please fetch comparables first.',
          needsFetch: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${comparables.length} cached comparables to score`);

    // 4. We don't have amenities stored in listings table, so use empty for now
    // In the future, this could be enhanced to fetch from Guesty or store in DB
    const targetAmenities: string[] = [];

    // 5. Score each comparable
    const scoredComparables = comparables.map((comp) => {
      const { score, breakdown } = scoreComparable(
        comp,
        targetBedrooms,
        targetLat,
        targetLng,
        targetRevenue,
        targetAmenities
      );
      return {
        ...comp,
        ai_score: score,
        score_breakdown: breakdown,
      };
    });

    // 6. Sort by score and take top N
    scoredComparables.sort((a, b) => b.ai_score - a.ai_score);
    const topSuggestions = scoredComparables.slice(0, max_selections);

    console.log(`Top ${max_selections} suggestions with scores: ${topSuggestions.map(s => `${s.listing_name}: ${s.ai_score}`).join(', ')}`);

    return new Response(
      JSON.stringify({
        success: true,
        suggestions: topSuggestions,
        totalScored: scoredComparables.length,
        targetDetails: {
          bedrooms: targetBedrooms,
          lat: targetLat,
          lng: targetLng,
          ttm_revenue: targetRevenue,
        },
        needsFetch: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in suggest-best-comparables:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
