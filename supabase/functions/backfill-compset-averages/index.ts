import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HistoricalMetric {
  date: string;
  revenue: number;
  average_daily_rate: number;
  occupancy: number;
  rev_par: number;
}

interface HistoricalMetricsData {
  results: HistoricalMetric[];
}

interface MonthlyAverage {
  month: string;
  revenue: number;
  adr: number;
  occupancy: number;
  revpar: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all listings that have selected comparables
    const { data: listings, error: listingsError } = await supabase
      .from('property_comparables')
      .select('listing_id')
      .eq('is_selected', true)
      .not('historical_metrics', 'is', null);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    // Get unique listing IDs
    const uniqueListingIds = [...new Set(listings?.map(l => l.listing_id) || [])];
    console.log(`Found ${uniqueListingIds.length} listings with selected comparables and historical metrics`);

    let processed = 0;
    let updated = 0;

    for (const listingId of uniqueListingIds) {
      processed++;
      
      // Get all selected comparables with historical metrics for this listing
      const { data: comparables, error: compError } = await supabase
        .from('property_comparables')
        .select('historical_metrics')
        .eq('listing_id', listingId)
        .eq('is_selected', true)
        .not('historical_metrics', 'is', null);

      if (compError || !comparables?.length) {
        console.log(`Skipping listing ${listingId}: no comparables with metrics`);
        continue;
      }

      // Aggregate metrics by month
      const monthlyData: Record<string, { revenue: number[]; adr: number[]; occupancy: number[]; revpar: number[] }> = {};

      for (const comp of comparables) {
        const metricsData = comp.historical_metrics as HistoricalMetricsData;
        const metrics = metricsData?.results;
        if (!Array.isArray(metrics)) continue;

        for (const metric of metrics) {
          if (!metric.date) continue;
          
          if (!monthlyData[metric.date]) {
            monthlyData[metric.date] = { revenue: [], adr: [], occupancy: [], revpar: [] };
          }
          
          if (typeof metric.revenue === 'number') monthlyData[metric.date].revenue.push(metric.revenue);
          if (typeof metric.average_daily_rate === 'number') monthlyData[metric.date].adr.push(metric.average_daily_rate);
          if (typeof metric.occupancy === 'number') monthlyData[metric.date].occupancy.push(metric.occupancy);
          if (typeof metric.rev_par === 'number') monthlyData[metric.date].revpar.push(metric.rev_par);
        }
      }

      // Calculate averages
      const monthlyAverages: MonthlyAverage[] = Object.entries(monthlyData)
        .map(([month, data]) => ({
          month,
          revenue: data.revenue.length > 0 ? data.revenue.reduce((a, b) => a + b, 0) / data.revenue.length : 0,
          adr: data.adr.length > 0 ? data.adr.reduce((a, b) => a + b, 0) / data.adr.length : 0,
          occupancy: data.occupancy.length > 0 ? data.occupancy.reduce((a, b) => a + b, 0) / data.occupancy.length : 0,
          revpar: data.revpar.length > 0 ? data.revpar.reduce((a, b) => a + b, 0) / data.revpar.length : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      if (monthlyAverages.length === 0) {
        console.log(`Skipping listing ${listingId}: no monthly data to aggregate`);
        continue;
      }

      // Upsert into property_compset_summary
      const { error: upsertError } = await supabase
        .from('property_compset_summary')
        .upsert({
          listing_id: listingId,
          monthly_averages: monthlyAverages,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'listing_id',
        });

      if (upsertError) {
        console.error(`Failed to update listing ${listingId}: ${upsertError.message}`);
      } else {
        updated++;
        console.log(`Updated listing ${listingId} with ${monthlyAverages.length} months of averages`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        updated,
        message: `Processed ${processed} listings, updated ${updated} with monthly averages`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
