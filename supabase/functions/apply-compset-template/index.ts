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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { template_id, listing_id } = await req.json();

    if (!template_id || !listing_id) {
      throw new Error('template_id and listing_id are required');
    }

    console.log(`Applying template ${template_id} to listing ${listing_id}`);

    // Fetch the template
    const { data: template, error: templateError } = await supabase
      .from('compset_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (templateError) throw templateError;
    if (!template) throw new Error('Template not found');

    const airroiListingIds = template.airroi_listing_ids as string[];
    console.log(`Template has ${airroiListingIds.length} comparable(s): ${airroiListingIds.join(', ')}`);

    if (airroiListingIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, applied: 0, message: 'Template has no comparables' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find existing comparable data in the database instead of calling Air ROI API
    const { data: existingComparables, error: fetchError } = await supabase
      .from('property_comparables')
      .select('*')
      .in('airroi_listing_id', airroiListingIds);

    if (fetchError) {
      console.error('Error fetching existing comparables:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${existingComparables?.length || 0} existing comparable records in database`);

    // Group by airroi_listing_id to get unique comparables (pick most recently fetched)
    const uniqueComparables = new Map();
    for (const comp of existingComparables || []) {
      const existing = uniqueComparables.get(comp.airroi_listing_id);
      if (!existing || new Date(comp.fetched_at || 0) > new Date(existing.fetched_at || 0)) {
        uniqueComparables.set(comp.airroi_listing_id, comp);
      }
    }

    console.log(`Unique comparables found: ${uniqueComparables.size}`);

    // Check for missing comparables
    const foundIds = new Set(Array.from(uniqueComparables.keys()));
    const missingIds = airroiListingIds.filter(id => !foundIds.has(id));

    if (missingIds.length > 0) {
      console.warn(`Missing comparables for airroi_listing_ids: ${missingIds.join(', ')}`);
    }

    // Create new records for the target listing
    const appliedComparables = Array.from(uniqueComparables.values()).map(comp => ({
      listing_id: listing_id,
      airroi_listing_id: comp.airroi_listing_id,
      listing_name: comp.listing_name,
      listing_type: comp.listing_type,
      room_type: comp.room_type,
      cover_photo_url: comp.cover_photo_url,
      host_name: comp.host_name,
      superhost: comp.superhost,
      location_info: comp.location_info,
      property_details: comp.property_details,
      pricing_info: comp.pricing_info,
      ratings: comp.ratings,
      booking_settings: comp.booking_settings,
      performance_metrics: comp.performance_metrics,
      historical_metrics: comp.historical_metrics,
      future_rates: comp.future_rates,
      future_rates_fetched_at: comp.future_rates_fetched_at,
      metrics_fetched_at: comp.metrics_fetched_at,
      ttm_revenue: comp.ttm_revenue,
      ttm_occupancy: comp.ttm_occupancy,
      ttm_adr: comp.ttm_adr,
      ttm_revpar: comp.ttm_revpar,
      prior_ttm_revenue: comp.prior_ttm_revenue,
      prior_ttm_occupancy: comp.prior_ttm_occupancy,
      prior_ttm_adr: comp.prior_ttm_adr,
      prior_ttm_revpar: comp.prior_ttm_revpar,
      is_selected: true,
      selected_at: new Date().toISOString(),
      fetched_at: comp.fetched_at,
    }));

    console.log(`Prepared ${appliedComparables.length} comparables for upsert`);

    // Upsert the comparables
    if (appliedComparables.length > 0) {
      const { error: upsertError } = await supabase
        .from('property_comparables')
        .upsert(appliedComparables, {
          onConflict: 'listing_id,airroi_listing_id',
        });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw upsertError;
      }
    }

    console.log(`Successfully applied ${appliedComparables.length} comparables from template`);

    return new Response(
      JSON.stringify({
        success: true,
        applied: appliedComparables.length,
        total: airroiListingIds.length,
        missing: missingIds,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error applying template:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
