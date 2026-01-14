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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listing_ids, max_selections = 5 } = await req.json();

    if (!listing_ids || !Array.isArray(listing_ids) || listing_ids.length === 0) {
      throw new Error('listing_ids must be a non-empty array');
    }

    console.log(`AI-selecting top ${max_selections} comparables for ${listing_ids.length} listings`);

    const results: { listing_id: string; selected: number; needs_fetch: boolean }[] = [];

    for (const listingId of listing_ids) {
      // 1. Fetch the target listing's details
      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .select('id, address, bedrooms')
        .eq('id', listingId)
        .single();

      if (listingError || !listing) {
        console.warn(`Listing ${listingId} not found, skipping`);
        results.push({ listing_id: listingId, selected: 0, needs_fetch: true });
        continue;
      }

      const address = listing.address as any;
      const targetLat = address?.lat;
      const targetLng = address?.lng;
      const targetBedrooms = listing.bedrooms || 0;

      if (!targetLat || !targetLng) {
        console.warn(`Listing ${listingId} has no coordinates, skipping`);
        results.push({ listing_id: listingId, selected: 0, needs_fetch: true });
        continue;
      }

      // 2. Get TTM revenue estimate for the property
      const { data: revData } = await supabase
        .from('reservation_nights')
        .select('revenue_allocation')
        .eq('listing_id', listingId)
        .gte('night_date', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      
      const targetRevenue = revData?.reduce((sum, r) => sum + (r.revenue_allocation || 0), 0) || null;

      // 3. Fetch all cached comparables for this listing
      const { data: comparables, error: compError } = await supabase
        .from('property_comparables')
        .select('*')
        .eq('listing_id', listingId);

      if (compError || !comparables || comparables.length === 0) {
        console.warn(`No cached comparables for ${listingId}`);
        results.push({ listing_id: listingId, selected: 0, needs_fetch: true });
        continue;
      }

      // 4. Score and sort comparables
      const scoredComparables = comparables.map((comp) => ({
        ...comp,
        ai_score: scoreComparable(comp, targetBedrooms, targetLat, targetLng, targetRevenue),
      }));

      scoredComparables.sort((a, b) => b.ai_score - a.ai_score);
      const topIds = scoredComparables.slice(0, max_selections).map(c => c.id);

      // 5. Update selection status - deselect all first, then select top N
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
        results.push({ listing_id: listingId, selected: 0, needs_fetch: false });
      } else {
        results.push({ listing_id: listingId, selected: topIds.length, needs_fetch: false });
        console.log(`Selected ${topIds.length} comparables for ${listingId}`);
      }
    }

    const totalSelected = results.reduce((sum, r) => sum + r.selected, 0);
    const needsFetch = results.filter(r => r.needs_fetch).length;

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: {
          total_selected: totalSelected,
          properties_processed: results.length,
          properties_needing_fetch: needsFetch,
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
