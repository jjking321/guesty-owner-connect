import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      throw new Error('AIRROI_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { template_id, listing_ids } = await req.json();

    if (!template_id) {
      throw new Error('template_id is required');
    }

    if (!listing_ids || !Array.isArray(listing_ids) || listing_ids.length === 0) {
      throw new Error('listing_ids must be a non-empty array');
    }

    console.log(`Batch applying template ${template_id} to ${listing_ids.length} listings`);

    // 1. Fetch the template
    const { data: template, error: templateError } = await supabase
      .from('compset_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (templateError) throw templateError;
    if (!template) throw new Error('Template not found');

    const airroiListingIds = template.airroi_listing_ids as string[];
    console.log(`Template has ${airroiListingIds.length} comparable(s)`);

    if (airroiListingIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, results: [], message: 'Template has no comparables' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check which comparables are already cached globally
    const { data: cachedComps } = await supabase
      .from('property_comparables')
      .select('airroi_listing_id, listing_name, listing_type, room_type, cover_photo_url, host_name, superhost, location_info, property_details, booking_settings, pricing_info, ratings, performance_metrics, historical_metrics, future_rates, ttm_revenue, ttm_adr, ttm_occupancy, ttm_revpar, prior_ttm_revenue, prior_ttm_adr, prior_ttm_occupancy, prior_ttm_revpar, metrics_fetched_at, future_rates_fetched_at, rollups_calculated_at, fetched_at')
      .in('airroi_listing_id', airroiListingIds)
      .limit(1000);

    // Build a map of cached comparable data by airroi_listing_id
    const cachedMap = new Map<string, any>();
    for (const comp of cachedComps || []) {
      if (!cachedMap.has(comp.airroi_listing_id)) {
        cachedMap.set(comp.airroi_listing_id, comp);
      }
    }

    console.log(`Found ${cachedMap.size} of ${airroiListingIds.length} comparables in cache`);

    // 3. Fetch any missing comparables from API
    const missingIds = airroiListingIds.filter(id => !cachedMap.has(id));
    const AIRROI_API_URL = 'https://api.airroi.com/v1/listings';

    for (const airroiId of missingIds) {
      try {
        console.log(`Fetching missing listing ${airroiId} from Air ROI`);
        
        const response = await fetch(`${AIRROI_API_URL}/${airroiId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${airroiApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch listing ${airroiId}: ${response.status}`);
          continue;
        }

        const listingData = await response.json();
        
        // Map to our schema format
        cachedMap.set(airroiId, {
          airroi_listing_id: String(airroiId),
          listing_name: listingData.listing_name || null,
          listing_type: listingData.listing_type || null,
          room_type: listingData.room_type || null,
          cover_photo_url: listingData.cover_photo_url || null,
          host_name: listingData.host_name || null,
          superhost: listingData.superhost || false,
          location_info: listingData.location || null,
          property_details: {
            guests: listingData.guests,
            bedrooms: listingData.bedrooms,
            beds: listingData.beds,
            baths: listingData.baths,
            amenities: listingData.amenities || [],
          },
          pricing_info: {
            currency: listingData.currency,
            cleaning_fee: listingData.cleaning_fee,
            extra_guest_fee: listingData.extra_guest_fee,
          },
          ratings: {
            num_reviews: listingData.num_reviews,
            rating_overall: listingData.rating_overall,
            rating_accuracy: listingData.rating_accuracy,
            rating_checkin: listingData.rating_checkin,
            rating_cleanliness: listingData.rating_cleanliness,
            rating_communication: listingData.rating_communication,
            rating_location: listingData.rating_location,
            rating_value: listingData.rating_value,
          },
          booking_settings: {
            min_nights: listingData.min_nights,
            max_nights: listingData.max_nights,
            instant_book: listingData.instant_book,
          },
          performance_metrics: {
            ttm_revenue: listingData.ttm_revenue,
            ttm_occupancy: listingData.ttm_occupancy,
            ttm_adr: listingData.ttm_adr,
            ttm_revpar: listingData.ttm_revpar,
            ttm_days_available: listingData.ttm_days_available,
            ttm_days_reserved: listingData.ttm_days_reserved,
            ttm_days_blocked: listingData.ttm_days_blocked,
          },
          fetched_at: new Date().toISOString(),
        });

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Error fetching listing ${airroiId}:`, err);
      }
    }

    // 4. Apply template to each listing
    const results: { listing_id: string; applied: number }[] = [];

    for (const listingId of listing_ids) {
      const toUpsert = [];

      for (const airroiId of airroiListingIds) {
        const cachedData = cachedMap.get(airroiId);
        if (!cachedData) continue;

        toUpsert.push({
          listing_id: listingId,
          airroi_listing_id: cachedData.airroi_listing_id || airroiId,
          listing_name: cachedData.listing_name,
          listing_type: cachedData.listing_type,
          room_type: cachedData.room_type,
          cover_photo_url: cachedData.cover_photo_url,
          host_name: cachedData.host_name,
          superhost: cachedData.superhost,
          location_info: cachedData.location_info,
          property_details: cachedData.property_details,
          booking_settings: cachedData.booking_settings,
          pricing_info: cachedData.pricing_info,
          ratings: cachedData.ratings,
          performance_metrics: cachedData.performance_metrics,
          historical_metrics: cachedData.historical_metrics,
          future_rates: cachedData.future_rates,
          ttm_revenue: cachedData.ttm_revenue,
          ttm_adr: cachedData.ttm_adr,
          ttm_occupancy: cachedData.ttm_occupancy,
          ttm_revpar: cachedData.ttm_revpar,
          prior_ttm_revenue: cachedData.prior_ttm_revenue,
          prior_ttm_adr: cachedData.prior_ttm_adr,
          prior_ttm_occupancy: cachedData.prior_ttm_occupancy,
          prior_ttm_revpar: cachedData.prior_ttm_revpar,
          metrics_fetched_at: cachedData.metrics_fetched_at,
          future_rates_fetched_at: cachedData.future_rates_fetched_at,
          rollups_calculated_at: cachedData.rollups_calculated_at,
          is_selected: true,
          selected_at: new Date().toISOString(),
          fetched_at: cachedData.fetched_at || new Date().toISOString(),
        });
      }

      if (toUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('property_comparables')
          .upsert(toUpsert, {
            onConflict: 'listing_id,airroi_listing_id',
          });

        if (upsertError) {
          console.error(`Error upserting to ${listingId}:`, upsertError);
        }
      }

      results.push({ listing_id: listingId, applied: toUpsert.length });
      console.log(`Applied ${toUpsert.length} comparables to ${listingId}`);
    }

    const totalApplied = results.reduce((sum, r) => sum + r.applied, 0);

    return new Response(
      JSON.stringify({
        success: true,
        template_name: template.name,
        template_comparables: airroiListingIds.length,
        api_fetched: missingIds.length,
        cache_reused: airroiListingIds.length - missingIds.length,
        results,
        summary: {
          total_applied: totalApplied,
          properties_processed: results.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in batch-apply-template:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
