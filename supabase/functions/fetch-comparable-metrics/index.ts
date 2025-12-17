import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/metrics/all';

interface HistoricalMetric {
  date: string;
  occupancy?: number;
  average_daily_rate?: number;
  rev_par?: number;
  revenue?: number;
}

interface TtmMetrics {
  revenue: number | null;
  adr: number | null;
  occupancy: number | null;
  revpar: number | null;
}

interface ComparableWithTtm {
  ttm_revenue: number | null;
  ttm_adr: number | null;
  ttm_occupancy: number | null;
  ttm_revpar: number | null;
  prior_ttm_revenue: number | null;
  prior_ttm_adr: number | null;
  prior_ttm_occupancy: number | null;
  prior_ttm_revpar: number | null;
}

function calculateTtmRollups(results: HistoricalMetric[]): { ttmMetrics: TtmMetrics; priorTtmMetrics: TtmMetrics } {
  if (!results || results.length === 0) {
    return {
      ttmMetrics: { revenue: null, adr: null, occupancy: null, revpar: null },
      priorTtmMetrics: { revenue: null, adr: null, occupancy: null, revpar: null },
    };
  }

  // Get current date and determine the last complete month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Last complete month is one month before current
  // TTM: Last 12 complete months
  // Prior TTM: 12 months before that (months 13-24)
  
  const ttmData: HistoricalMetric[] = [];
  const priorTtmData: HistoricalMetric[] = [];

  for (const record of results) {
    const recordDate = new Date(record.date);
    const recordYear = recordDate.getFullYear();
    const recordMonth = recordDate.getMonth();

    // Calculate months ago from current month (excluding current incomplete month)
    const monthsAgo = (currentYear - recordYear) * 12 + (currentMonth - recordMonth);

    // TTM: 1-12 months ago (excludes current month which is incomplete)
    if (monthsAgo >= 1 && monthsAgo <= 12) {
      ttmData.push(record);
    }
    // Prior TTM: 13-24 months ago
    else if (monthsAgo >= 13 && monthsAgo <= 24) {
      priorTtmData.push(record);
    }
  }

  console.log(`TTM data points: ${ttmData.length}, Prior TTM data points: ${priorTtmData.length}`);

  const calculateMetrics = (data: HistoricalMetric[]): TtmMetrics => {
    if (data.length === 0) {
      return { revenue: null, adr: null, occupancy: null, revpar: null };
    }

    // Revenue is SUM
    const revenueValues = data.filter(d => d.revenue != null).map(d => d.revenue!);
    const revenue = revenueValues.length > 0 ? revenueValues.reduce((a, b) => a + b, 0) : null;

    // ADR, Occupancy, RevPAR are simple averages
    const adrValues = data.filter(d => d.average_daily_rate != null).map(d => d.average_daily_rate!);
    const adr = adrValues.length > 0 ? adrValues.reduce((a, b) => a + b, 0) / adrValues.length : null;

    const occValues = data.filter(d => d.occupancy != null).map(d => d.occupancy!);
    const occupancy = occValues.length > 0 ? occValues.reduce((a, b) => a + b, 0) / occValues.length : null;

    const revparValues = data.filter(d => d.rev_par != null).map(d => d.rev_par!);
    const revpar = revparValues.length > 0 ? revparValues.reduce((a, b) => a + b, 0) / revparValues.length : null;

    return { revenue, adr, occupancy, revpar };
  };

  return {
    ttmMetrics: calculateMetrics(ttmData),
    priorTtmMetrics: calculateMetrics(priorTtmData),
  };
}

interface MonthlyAverage {
  month: string;
  revenue: number;
  adr: number;
  occupancy: number;
  revpar: number;
}

async function updateCompsetSummary(
  supabase: any,
  listingId: string
): Promise<void> {
  console.log(`Updating compset summary for listing ${listingId}`);

  // Get all selected comparables with TTM data AND historical metrics
  const { data: selectedComps, error: selectError } = await supabase
    .from('property_comparables')
    .select('ttm_revenue, ttm_adr, ttm_occupancy, ttm_revpar, prior_ttm_revenue, prior_ttm_adr, prior_ttm_occupancy, prior_ttm_revpar, historical_metrics')
    .eq('listing_id', listingId)
    .eq('is_selected', true)
    .not('ttm_revenue', 'is', null);

  if (selectError) {
    console.error(`Failed to fetch selected comparables for compset summary: ${selectError.message}`);
    return;
  }

  // Cast to proper type since new columns may not be in generated types yet
  const comps = (selectedComps || []) as unknown as (ComparableWithTtm & { historical_metrics?: { results?: HistoricalMetric[] } })[];

  if (comps.length === 0) {
    console.log(`No selected comparables with TTM data for listing ${listingId}`);
    // Delete any existing summary
    await supabase
      .from('property_compset_summary')
      .delete()
      .eq('listing_id', listingId);
    return;
  }

  // Calculate simple averages for TTM metrics
  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };

  // Calculate monthly averages from historical_metrics
  const monthlyDataMap = new Map<string, { revenue: number[]; adr: number[]; occupancy: number[]; revpar: number[] }>();

  for (const comp of comps) {
    const results = comp.historical_metrics?.results || [];
    for (const record of results) {
      if (!record.date) continue;
      const monthKey = record.date; // Already in "YYYY-MM" format
      
      if (!monthlyDataMap.has(monthKey)) {
        monthlyDataMap.set(monthKey, { revenue: [], adr: [], occupancy: [], revpar: [] });
      }
      
      const monthData = monthlyDataMap.get(monthKey)!;
      if (record.revenue != null) monthData.revenue.push(record.revenue);
      if (record.average_daily_rate != null) monthData.adr.push(record.average_daily_rate);
      if (record.occupancy != null) monthData.occupancy.push(record.occupancy);
      if (record.rev_par != null) monthData.revpar.push(record.rev_par);
    }
  }

  // Convert to array of monthly averages
  const monthlyAverages: MonthlyAverage[] = [];
  for (const [month, data] of monthlyDataMap.entries()) {
    monthlyAverages.push({
      month,
      revenue: data.revenue.length > 0 ? data.revenue.reduce((a, b) => a + b, 0) / data.revenue.length : 0,
      adr: data.adr.length > 0 ? data.adr.reduce((a, b) => a + b, 0) / data.adr.length : 0,
      occupancy: data.occupancy.length > 0 ? data.occupancy.reduce((a, b) => a + b, 0) / data.occupancy.length : 0,
      revpar: data.revpar.length > 0 ? data.revpar.reduce((a, b) => a + b, 0) / data.revpar.length : 0,
    });
  }

  // Sort by month descending (most recent first)
  monthlyAverages.sort((a, b) => b.month.localeCompare(a.month));

  console.log(`Calculated ${monthlyAverages.length} monthly averages for listing ${listingId}`);

  const summary = {
    listing_id: listingId,
    avg_ttm_revenue: avg(comps.map(c => c.ttm_revenue)),
    avg_ttm_adr: avg(comps.map(c => c.ttm_adr)),
    avg_ttm_occupancy: avg(comps.map(c => c.ttm_occupancy)),
    avg_ttm_revpar: avg(comps.map(c => c.ttm_revpar)),
    avg_prior_ttm_revenue: avg(comps.map(c => c.prior_ttm_revenue)),
    avg_prior_ttm_adr: avg(comps.map(c => c.prior_ttm_adr)),
    avg_prior_ttm_occupancy: avg(comps.map(c => c.prior_ttm_occupancy)),
    avg_prior_ttm_revpar: avg(comps.map(c => c.prior_ttm_revpar)),
    monthly_averages: monthlyAverages,
    selected_comparables_count: comps.length,
    calculated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Use upsert with any type to avoid type issues with new table
  const { error: upsertError } = await (supabase as any)
    .from('property_compset_summary')
    .upsert(summary, { onConflict: 'listing_id' });

  if (upsertError) {
    console.error(`Failed to upsert compset summary: ${upsertError.message}`);
  } else {
    console.log(`Updated compset summary for listing ${listingId} with ${comps.length} comparables and ${monthlyAverages.length} monthly averages`);
  }
}

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

    const { comparable_ids } = await req.json();

    if (!comparable_ids || !Array.isArray(comparable_ids) || comparable_ids.length === 0) {
      throw new Error('comparable_ids array is required');
    }

    console.log(`Fetching historical metrics for ${comparable_ids.length} comparables`);

    // Fetch the comparables to get their airroi_listing_ids and listing_id
    const { data: comparables, error: fetchError } = await supabase
      .from('property_comparables')
      .select('id, airroi_listing_id, listing_id')
      .in('id', comparable_ids);

    if (fetchError) {
      throw new Error(`Failed to fetch comparables: ${fetchError.message}`);
    }

    if (!comparables || comparables.length === 0) {
      throw new Error('No comparables found with the provided IDs');
    }

    console.log(`Found ${comparables.length} comparables to fetch metrics for`);

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    const affectedListingIds = new Set<string>();

    // Fetch metrics for each comparable
    for (const comparable of comparables) {
      try {
        console.log(`Fetching metrics for airroi_listing_id: ${comparable.airroi_listing_id}`);

        const url = `${AIRROI_API_URL}?id=${comparable.airroi_listing_id}&num_months=60&currency=usd`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': airroiApiKey,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API error for ${comparable.airroi_listing_id}: ${response.status} - ${errorText}`);
          errors.push(`ID ${comparable.airroi_listing_id}: ${response.status}`);
          failedCount++;
          continue;
        }

        const metricsData = await response.json();
        console.log(`Received metrics data for ${comparable.airroi_listing_id}: ${JSON.stringify(metricsData).slice(0, 200)}...`);

        // Calculate TTM rollups
        const { ttmMetrics, priorTtmMetrics } = calculateTtmRollups(metricsData.results || []);
        console.log(`Calculated TTM metrics for ${comparable.airroi_listing_id}:`, ttmMetrics);

        // Update the comparable with the historical metrics and rollups
        const { error: updateError } = await supabase
          .from('property_comparables')
          .update({
            historical_metrics: metricsData,
            ttm_revenue: ttmMetrics.revenue,
            ttm_adr: ttmMetrics.adr,
            ttm_occupancy: ttmMetrics.occupancy,
            ttm_revpar: ttmMetrics.revpar,
            prior_ttm_revenue: priorTtmMetrics.revenue,
            prior_ttm_adr: priorTtmMetrics.adr,
            prior_ttm_occupancy: priorTtmMetrics.occupancy,
            prior_ttm_revpar: priorTtmMetrics.revpar,
            rollups_calculated_at: new Date().toISOString(),
            metrics_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', comparable.id);

        if (updateError) {
          console.error(`Failed to update comparable ${comparable.id}: ${updateError.message}`);
          errors.push(`Update ${comparable.id}: ${updateError.message}`);
          failedCount++;
        } else {
          console.log(`Successfully updated metrics for comparable ${comparable.id}`);
          successCount++;
          affectedListingIds.add(comparable.listing_id);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error processing comparable ${comparable.id}:`, error);
        errors.push(`Process ${comparable.airroi_listing_id}: ${errorMessage}`);
        failedCount++;
      }
    }

    // Update compset summaries for all affected listings
    for (const listingId of affectedListingIds) {
      await updateCompsetSummary(supabase, listingId);
    }

    console.log(`Completed: ${successCount} success, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        fetched: successCount,
        failed: failedCount,
        total: comparables.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in fetch-comparable-metrics:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
