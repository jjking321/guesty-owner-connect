import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourceRecord {
  airroi_listing_id: string;
  historical_metrics: unknown;
  ttm_revenue: number | null;
  ttm_adr: number | null;
  ttm_occupancy: number | null;
  ttm_revpar: number | null;
  prior_ttm_revenue: number | null;
  prior_ttm_adr: number | null;
  prior_ttm_occupancy: number | null;
  prior_ttm_revpar: number | null;
  future_rates: unknown;
  metrics_fetched_at: string | null;
  future_rates_fetched_at: string | null;
  rollups_calculated_at: string | null;
}

interface ComparableRecord {
  ttm_revenue: number | null;
  ttm_adr: number | null;
  ttm_occupancy: number | null;
  ttm_revpar: number | null;
  prior_ttm_revenue: number | null;
  prior_ttm_adr: number | null;
  prior_ttm_occupancy: number | null;
  prior_ttm_revpar: number | null;
  historical_metrics: unknown;
  future_rates: unknown;
}

interface HistoricalMetric {
  date: string;
  revenue: number;
  average_daily_rate: number;
  occupancy: number;
  revpar: number;
}

interface FutureRateDay {
  date: string;
  rate: number;
  is_available: boolean;
}

// Reuse the compset summary update logic
async function updateCompsetSummary(supabase: SupabaseClient, listingId: string): Promise<void> {
  console.log(`Updating compset summary for listing: ${listingId}`);
  
  const { data: selectedComparables, error: compError } = await supabase
    .from('property_comparables')
    .select('ttm_revenue, ttm_adr, ttm_occupancy, ttm_revpar, prior_ttm_revenue, prior_ttm_adr, prior_ttm_occupancy, prior_ttm_revpar, historical_metrics, future_rates')
    .eq('listing_id', listingId)
    .eq('is_selected', true);

  if (compError) {
    console.error(`Failed to fetch comparables for summary: ${compError.message}`);
    return;
  }

  const comparables = (selectedComparables || []) as ComparableRecord[];

  if (comparables.length === 0) {
    console.log(`No selected comparables for listing ${listingId}`);
    return;
  }

  // Calculate TTM averages
  const withTtmData = comparables.filter(c => c.ttm_revenue !== null);
  const withPriorData = comparables.filter(c => c.prior_ttm_revenue !== null);

  const avgTtmRevenue = withTtmData.length > 0 
    ? withTtmData.reduce((sum, c) => sum + (c.ttm_revenue || 0), 0) / withTtmData.length 
    : null;
  const avgTtmAdr = withTtmData.length > 0 
    ? withTtmData.reduce((sum, c) => sum + (c.ttm_adr || 0), 0) / withTtmData.length 
    : null;
  const avgTtmOccupancy = withTtmData.length > 0 
    ? withTtmData.reduce((sum, c) => sum + (c.ttm_occupancy || 0), 0) / withTtmData.length 
    : null;
  const avgTtmRevpar = withTtmData.length > 0 
    ? withTtmData.reduce((sum, c) => sum + (c.ttm_revpar || 0), 0) / withTtmData.length 
    : null;

  const avgPriorTtmRevenue = withPriorData.length > 0
    ? withPriorData.reduce((sum, c) => sum + (c.prior_ttm_revenue || 0), 0) / withPriorData.length
    : null;
  const avgPriorTtmAdr = withPriorData.length > 0
    ? withPriorData.reduce((sum, c) => sum + (c.prior_ttm_adr || 0), 0) / withPriorData.length
    : null;
  const avgPriorTtmOccupancy = withPriorData.length > 0
    ? withPriorData.reduce((sum, c) => sum + (c.prior_ttm_occupancy || 0), 0) / withPriorData.length
    : null;
  const avgPriorTtmRevpar = withPriorData.length > 0
    ? withPriorData.reduce((sum, c) => sum + (c.prior_ttm_revpar || 0), 0) / withPriorData.length
    : null;

  // Calculate monthly averages from historical_metrics
  const monthlyData: Record<string, { revenue: number[]; adr: number[]; occupancy: number[]; revpar: number[] }> = {};
  
  for (const comp of comparables) {
    const metricsData = comp.historical_metrics as { results?: HistoricalMetric[] } | null;
    if (metricsData?.results && Array.isArray(metricsData.results)) {
      for (const metric of metricsData.results) {
        const key = metric.date;
        if (!monthlyData[key]) {
          monthlyData[key] = { revenue: [], adr: [], occupancy: [], revpar: [] };
        }
        if (metric.revenue != null) monthlyData[key].revenue.push(metric.revenue);
        if (metric.average_daily_rate != null) monthlyData[key].adr.push(metric.average_daily_rate);
        if (metric.occupancy != null) monthlyData[key].occupancy.push(metric.occupancy);
        if (metric.revpar != null) monthlyData[key].revpar.push(metric.revpar);
      }
    }
  }

  const monthlyAverages = Object.entries(monthlyData)
    .map(([month, data]) => ({
      month: month,
      revenue: data.revenue.length > 0 ? data.revenue.reduce((a, b) => a + b, 0) / data.revenue.length : null,
      adr: data.adr.length > 0 ? data.adr.reduce((a, b) => a + b, 0) / data.adr.length : null,
      occupancy: data.occupancy.length > 0 ? data.occupancy.reduce((a, b) => a + b, 0) / data.occupancy.length : null,
      revpar: data.revpar.length > 0 ? data.revpar.reduce((a, b) => a + b, 0) / data.revpar.length : null,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Calculate future monthly averages
  const futureMonthlyData: Record<string, { adr: number[]; occupancy: number[]; revpar: number[] }> = {};
  
  for (const comp of comparables) {
    if (comp.future_rates && Array.isArray(comp.future_rates)) {
      for (const day of comp.future_rates as FutureRateDay[]) {
        if (!day.date || day.rate == null) continue;
        const yearMonth = day.date.substring(0, 7);
        if (!futureMonthlyData[yearMonth]) {
          futureMonthlyData[yearMonth] = { adr: [], occupancy: [], revpar: [] };
        }
        futureMonthlyData[yearMonth].adr.push(day.rate);
        futureMonthlyData[yearMonth].occupancy.push(day.is_available ? 0 : 1);
        futureMonthlyData[yearMonth].revpar.push(day.is_available ? 0 : day.rate);
      }
    }
  }

  const futureMonthlyAverages = Object.entries(futureMonthlyData)
    .map(([yearMonth, data]) => ({
      year_month: yearMonth,
      avg_adr: data.adr.length > 0 ? data.adr.reduce((a, b) => a + b, 0) / data.adr.length : null,
      avg_occupancy: data.occupancy.length > 0 ? (data.occupancy.reduce((a, b) => a + b, 0) / data.occupancy.length) * 100 : null,
      avg_revpar: data.revpar.length > 0 ? data.revpar.reduce((a, b) => a + b, 0) / data.revpar.length : null,
    }))
    .sort((a, b) => a.year_month.localeCompare(b.year_month));

  const { error: upsertError } = await supabase
    .from('property_compset_summary')
    .upsert({
      listing_id: listingId,
      selected_comparables_count: comparables.length,
      avg_ttm_revenue: avgTtmRevenue,
      avg_ttm_adr: avgTtmAdr,
      avg_ttm_occupancy: avgTtmOccupancy,
      avg_ttm_revpar: avgTtmRevpar,
      avg_prior_ttm_revenue: avgPriorTtmRevenue,
      avg_prior_ttm_adr: avgPriorTtmAdr,
      avg_prior_ttm_occupancy: avgPriorTtmOccupancy,
      avg_prior_ttm_revpar: avgPriorTtmRevpar,
      monthly_averages: monthlyAverages,
      future_monthly_averages: futureMonthlyAverages,
      calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'listing_id' });

  if (upsertError) {
    console.error(`Failed to upsert compset summary: ${upsertError.message}`);
  } else {
    console.log(`Updated compset summary for ${listingId}: ${comparables.length} comparables`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting backfill of comparable data...');

    // Step 1: Get all records that HAVE historical metrics (the source data)
    // We need to deduplicate by airroi_listing_id to get one source per comparable
    const { data: allRecordsWithMetrics, error: sourceError } = await supabase
      .from('property_comparables')
      .select('airroi_listing_id, historical_metrics, ttm_revenue, ttm_adr, ttm_occupancy, ttm_revpar, prior_ttm_revenue, prior_ttm_adr, prior_ttm_occupancy, prior_ttm_revpar, future_rates, metrics_fetched_at, future_rates_fetched_at, rollups_calculated_at')
      .not('ttm_revenue', 'is', null);

    if (sourceError) {
      throw new Error(`Failed to fetch source records: ${sourceError.message}`);
    }

    console.log(`Found ${allRecordsWithMetrics?.length || 0} records with historical metrics`);

    if (!allRecordsWithMetrics || allRecordsWithMetrics.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No records with metrics found to backfill from',
        stats: { sourceRecords: 0, updatedRecords: 0, affectedListings: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Deduplicate to get one source record per airroi_listing_id
    const sourceMap = new Map<string, SourceRecord>();
    for (const record of allRecordsWithMetrics) {
      // Keep the first one we find (they should all have the same data)
      if (!sourceMap.has(record.airroi_listing_id)) {
        sourceMap.set(record.airroi_listing_id, record as SourceRecord);
      }
    }

    console.log(`Deduplicated to ${sourceMap.size} unique airroi_listing_ids with metrics`);

    // Step 2: For each unique airroi_listing_id, update ALL records that are missing metrics
    let totalUpdated = 0;
    const affectedListingIds = new Set<string>();

    for (const [airroiId, source] of sourceMap.entries()) {
      // Find all records with this airroi_listing_id that are MISSING ttm_revenue
      const { data: recordsToUpdate, error: findError } = await supabase
        .from('property_comparables')
        .select('id, listing_id')
        .eq('airroi_listing_id', airroiId)
        .is('ttm_revenue', null);

      if (findError) {
        console.error(`Error finding records for ${airroiId}: ${findError.message}`);
        continue;
      }

      if (!recordsToUpdate || recordsToUpdate.length === 0) {
        continue; // All records already have data
      }

      // Update these records with the source data
      const idsToUpdate = recordsToUpdate.map(r => r.id);
      
      const { error: updateError } = await supabase
        .from('property_comparables')
        .update({
          historical_metrics: source.historical_metrics,
          ttm_revenue: source.ttm_revenue,
          ttm_adr: source.ttm_adr,
          ttm_occupancy: source.ttm_occupancy,
          ttm_revpar: source.ttm_revpar,
          prior_ttm_revenue: source.prior_ttm_revenue,
          prior_ttm_adr: source.prior_ttm_adr,
          prior_ttm_occupancy: source.prior_ttm_occupancy,
          prior_ttm_revpar: source.prior_ttm_revpar,
          future_rates: source.future_rates,
          metrics_fetched_at: source.metrics_fetched_at,
          future_rates_fetched_at: source.future_rates_fetched_at,
          rollups_calculated_at: source.rollups_calculated_at,
          updated_at: new Date().toISOString(),
        })
        .in('id', idsToUpdate);

      if (updateError) {
        console.error(`Error updating records for ${airroiId}: ${updateError.message}`);
        continue;
      }

      totalUpdated += recordsToUpdate.length;
      
      // Track affected listings for summary recalculation
      for (const record of recordsToUpdate) {
        affectedListingIds.add(record.listing_id);
      }

      console.log(`Updated ${recordsToUpdate.length} records for airroi_listing_id ${airroiId}`);
    }

    console.log(`Backfill complete: updated ${totalUpdated} records across ${affectedListingIds.size} listings`);

    // Step 3: Recalculate compset summaries for all affected listings
    console.log(`Recalculating compset summaries for ${affectedListingIds.size} listings...`);
    
    let summariesUpdated = 0;
    for (const listingId of affectedListingIds) {
      await updateCompsetSummary(supabase, listingId);
      summariesUpdated++;
      
      // Log progress every 50 listings
      if (summariesUpdated % 50 === 0) {
        console.log(`Processed ${summariesUpdated}/${affectedListingIds.size} compset summaries`);
      }
    }

    console.log(`Completed recalculating ${summariesUpdated} compset summaries`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Backfill completed successfully',
      stats: {
        sourceRecords: sourceMap.size,
        updatedRecords: totalUpdated,
        affectedListings: affectedListingIds.size,
        summariesRecalculated: summariesUpdated
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
