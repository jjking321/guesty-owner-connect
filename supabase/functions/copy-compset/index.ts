import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { source_listing_id, target_listing_ids } = await req.json();

    if (!source_listing_id) {
      throw new Error('source_listing_id is required');
    }

    if (!target_listing_ids || !Array.isArray(target_listing_ids) || target_listing_ids.length === 0) {
      throw new Error('target_listing_ids must be a non-empty array');
    }

    console.log(`Copying compset from ${source_listing_id} to ${target_listing_ids.length} properties`);

    // 1. Fetch selected comparables from source listing
    const { data: sourceComparables, error: sourceError } = await supabase
      .from('property_comparables')
      .select('*')
      .eq('listing_id', source_listing_id)
      .eq('is_selected', true);

    if (sourceError) {
      throw new Error(`Failed to fetch source comparables: ${sourceError.message}`);
    }

    if (!sourceComparables || sourceComparables.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Source listing has no selected comparables',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${sourceComparables.length} selected comparables to copy`);

    const results: { listing_id: string; copied: number; skipped: number }[] = [];

    // 2. For each target listing, copy the comparables
    for (const targetListingId of target_listing_ids) {
      if (targetListingId === source_listing_id) {
        console.log(`Skipping source listing ${targetListingId}`);
        continue;
      }

      // Check which comparables already exist for this target
      const { data: existingComps } = await supabase
        .from('property_comparables')
        .select('airroi_listing_id')
        .eq('listing_id', targetListingId);

      const existingIds = new Set((existingComps || []).map(c => c.airroi_listing_id));

      let copied = 0;
      let skipped = 0;
      const toUpsert = [];

      for (const sourceComp of sourceComparables) {
        if (existingIds.has(sourceComp.airroi_listing_id)) {
          // Just update selection status
          const { error: updateError } = await supabase
            .from('property_comparables')
            .update({
              is_selected: true,
              selected_at: new Date().toISOString(),
            })
            .eq('listing_id', targetListingId)
            .eq('airroi_listing_id', sourceComp.airroi_listing_id);

          if (!updateError) {
            skipped++;
          }
        } else {
          // Copy the full comparable data
          toUpsert.push({
            listing_id: targetListingId,
            airroi_listing_id: sourceComp.airroi_listing_id,
            listing_name: sourceComp.listing_name,
            listing_type: sourceComp.listing_type,
            room_type: sourceComp.room_type,
            cover_photo_url: sourceComp.cover_photo_url,
            host_name: sourceComp.host_name,
            superhost: sourceComp.superhost,
            location_info: sourceComp.location_info,
            property_details: sourceComp.property_details,
            booking_settings: sourceComp.booking_settings,
            pricing_info: sourceComp.pricing_info,
            ratings: sourceComp.ratings,
            performance_metrics: sourceComp.performance_metrics,
            historical_metrics: sourceComp.historical_metrics,
            future_rates: sourceComp.future_rates,
            ttm_revenue: sourceComp.ttm_revenue,
            ttm_adr: sourceComp.ttm_adr,
            ttm_occupancy: sourceComp.ttm_occupancy,
            ttm_revpar: sourceComp.ttm_revpar,
            prior_ttm_revenue: sourceComp.prior_ttm_revenue,
            prior_ttm_adr: sourceComp.prior_ttm_adr,
            prior_ttm_occupancy: sourceComp.prior_ttm_occupancy,
            prior_ttm_revpar: sourceComp.prior_ttm_revpar,
            metrics_fetched_at: sourceComp.metrics_fetched_at,
            future_rates_fetched_at: sourceComp.future_rates_fetched_at,
            rollups_calculated_at: sourceComp.rollups_calculated_at,
            is_selected: true,
            selected_at: new Date().toISOString(),
            fetched_at: sourceComp.fetched_at,
          });
          copied++;
        }
      }

      if (toUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('property_comparables')
          .upsert(toUpsert, {
            onConflict: 'listing_id,airroi_listing_id',
          });

        if (upsertError) {
          console.error(`Error upserting to ${targetListingId}:`, upsertError);
          throw upsertError;
        }
      }

      results.push({ listing_id: targetListingId, copied, skipped });
      console.log(`Copied ${copied}, updated ${skipped} comparables to ${targetListingId}`);
    }

    const totalCopied = results.reduce((sum, r) => sum + r.copied, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);

    return new Response(
      JSON.stringify({
        success: true,
        source_listing_id,
        source_comparables_count: sourceComparables.length,
        results,
        summary: {
          total_copied: totalCopied,
          total_updated: totalSkipped,
          properties_processed: results.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in copy-compset:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
