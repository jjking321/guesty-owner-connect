import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const ttmData: HistoricalMetric[] = [];
  const priorTtmData: HistoricalMetric[] = [];

  for (const record of results) {
    const recordDate = new Date(record.date);
    const recordYear = recordDate.getFullYear();
    const recordMonth = recordDate.getMonth();
    const monthsAgo = (currentYear - recordYear) * 12 + (currentMonth - recordMonth);

    if (monthsAgo >= 1 && monthsAgo <= 12) {
      ttmData.push(record);
    } else if (monthsAgo >= 13 && monthsAgo <= 24) {
      priorTtmData.push(record);
    }
  }

  const calculateMetrics = (data: HistoricalMetric[]): TtmMetrics => {
    if (data.length === 0) {
      return { revenue: null, adr: null, occupancy: null, revpar: null };
    }

    const revenueValues = data.filter(d => d.revenue != null).map(d => d.revenue!);
    const revenue = revenueValues.length > 0 ? revenueValues.reduce((a, b) => a + b, 0) : null;

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

async function updateCompsetSummary(supabase: any, listingId: string): Promise<void> {
  console.log(`Updating compset summary for listing ${listingId}`);

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

  const comps = (selectedComps || []) as unknown as (ComparableWithTtm & { historical_metrics?: { results?: HistoricalMetric[] } })[];

  if (comps.length === 0) {
    console.log(`No selected comparables with TTM data for listing ${listingId}`);
    await supabase.from('property_compset_summary').delete().eq('listing_id', listingId);
    return;
  }

  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };

  const monthlyDataMap = new Map<string, { revenue: number[]; adr: number[]; occupancy: number[]; revpar: number[] }>();

  for (const comp of comps) {
    const results = comp.historical_metrics?.results || [];
    for (const record of results) {
      if (!record.date) continue;
      const monthKey = record.date;
      
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

  monthlyAverages.sort((a, b) => b.month.localeCompare(a.month));

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

  const { error: upsertError } = await (supabase as any)
    .from('property_compset_summary')
    .upsert(summary, { onConflict: 'listing_id' });

  if (upsertError) {
    console.error(`Failed to upsert compset summary: ${upsertError.message}`);
  } else {
    console.log(`Updated compset summary for listing ${listingId} with ${comps.length} comparables`);
  }
}

async function processComparables(
  supabase: any,
  airroiApiKey: string,
  airroiIdToRecords: Map<string, Array<{ id: string; listing_id: string }>>,
  syncJobId: string | null
): Promise<{ successCount: number; recordsUpdated: number; errors: string[]; affectedListingIds: Set<string> }> {
  let successCount = 0;
  let recordsUpdated = 0;
  const errors: string[] = [];
  const affectedListingIds = new Set<string>();
  const totalItems = airroiIdToRecords.size;

  for (const [airroiListingId, records] of airroiIdToRecords.entries()) {
    try {
      console.log(`Fetching metrics for airroi_listing_id: ${airroiListingId} (affects ${records.length} records)`);

      const url = `${AIRROI_API_URL}?id=${airroiListingId}&num_months=60&currency=usd`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': airroiApiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error for ${airroiListingId}: ${response.status} - ${errorText}`);
        errors.push(`ID ${airroiListingId}: ${response.status}`);
        continue;
      }

      const metricsData = await response.json();
      console.log(`Received metrics data for ${airroiListingId}`);

      const { ttmMetrics, priorTtmMetrics } = calculateTtmRollups(metricsData.results || []);

      // Update ALL records that share this airroi_listing_id IMMEDIATELY (save as we go)
      const recordIds = records.map(r => r.id);
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
        .in('id', recordIds);

      if (updateError) {
        console.error(`Failed to update comparables for ${airroiListingId}: ${updateError.message}`);
        errors.push(`Update ${airroiListingId}: ${updateError.message}`);
      } else {
        console.log(`Successfully updated ${records.length} records for airroi_listing_id ${airroiListingId}`);
        successCount++;
        recordsUpdated += records.length;
        records.forEach(r => affectedListingIds.add(r.listing_id));
      }

      // Update sync job progress after each successful fetch
      if (syncJobId) {
        await supabase
          .from('sync_jobs')
          .update({
            items_synced: successCount,
            progress_message: `Fetched metrics for ${successCount}/${totalItems} comparables`,
          })
          .eq('id', syncJobId);
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error processing airroi_listing_id ${airroiListingId}:`, error);
      errors.push(`Process ${airroiListingId}: ${errorMessage}`);
    }
  }

  return { successCount, recordsUpdated, errors, affectedListingIds };
}

serve(async (req) => {
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
    const { comparable_ids, guesty_account_id } = await req.json();

    if (!comparable_ids || !Array.isArray(comparable_ids) || comparable_ids.length === 0) {
      throw new Error('comparable_ids array is required');
    }

    console.log(`Fetching historical metrics for ${comparable_ids.length} comparables`);

    // Fetch comparables
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

    // Extract unique airroi_listing_ids from passed comparables
    const uniqueAirroiIds = [...new Set(comparables.map(c => c.airroi_listing_id))];
    console.log(`Found ${uniqueAirroiIds.length} unique airroi_listing_ids from ${comparables.length} passed records`);

    // Fetch ALL property_comparables records that share these airroi_listing_ids
    // This ensures we update ALL records across ALL properties, not just the passed ones
    const { data: allMatchingRecords, error: matchError } = await supabase
      .from('property_comparables')
      .select('id, airroi_listing_id, listing_id')
      .in('airroi_listing_id', uniqueAirroiIds);

    if (matchError) {
      console.error(`Failed to fetch matching records: ${matchError.message}`);
    }

    const recordsToProcess = allMatchingRecords || comparables;
    console.log(`Found ${recordsToProcess.length} total records across all properties sharing these ${uniqueAirroiIds.length} airroi_listing_ids`);

    // Build the map using ALL matching records
    const airroiIdToRecords = new Map<string, Array<{ id: string; listing_id: string }>>();
    
    for (const record of recordsToProcess) {
      const key = record.airroi_listing_id;
      if (!airroiIdToRecords.has(key)) {
        airroiIdToRecords.set(key, []);
      }
      airroiIdToRecords.get(key)!.push({
        id: record.id,
        listing_id: record.listing_id
      });
    }

    console.log(`Will make ${airroiIdToRecords.size} API calls, updating ${recordsToProcess.length} total records`);

    // If guesty_account_id provided, create sync job and process in background
    if (guesty_account_id) {
      const { data: syncJob, error: jobError } = await supabase
        .from('sync_jobs')
        .insert({
          guesty_account_id,
          sync_type: 'comparable_historical',
          status: 'running',
          total_items: airroiIdToRecords.size,
          items_synced: 0,
          progress_message: `Starting historical metrics fetch for ${airroiIdToRecords.size} comparables...`,
        })
        .select()
        .single();

      if (jobError) {
        console.error('Error creating sync job:', jobError);
      } else {
        console.log(`Created sync job ${syncJob.id}`);

        // Process in background
        EdgeRuntime.waitUntil((async () => {
          try {
            const { successCount, recordsUpdated, errors, affectedListingIds } = await processComparables(
              supabase,
              airroiApiKey,
              airroiIdToRecords,
              syncJob.id
            );

            // Update compset summaries for all affected listings
            console.log(`Updating compset summaries for ${affectedListingIds.size} affected listings`);
            for (const listingId of affectedListingIds) {
              await updateCompsetSummary(supabase, listingId);
            }

            // Mark job as completed
            await supabase
              .from('sync_jobs')
              .update({
                status: errors.length > 0 ? 'completed_with_errors' : 'completed',
                completed_at: new Date().toISOString(),
                items_synced: successCount,
                progress_message: `Completed: ${successCount}/${airroiIdToRecords.size} API calls, ${recordsUpdated} records updated`,
                error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
              })
              .eq('id', syncJob.id);
          } catch (error: any) {
            console.error('Background processing error:', error);
            await supabase
              .from('sync_jobs')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_message: error.message,
              })
              .eq('id', syncJob.id);
          }
        })());

        // Return immediately with job ID
        return new Response(
          JSON.stringify({
            success: true,
            sync_job_id: syncJob.id,
            message: `Started fetching metrics for ${airroiIdToRecords.size} comparables`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    // Fallback: synchronous processing (no guesty_account_id)
    const { successCount, recordsUpdated, errors, affectedListingIds } = await processComparables(
      supabase,
      airroiApiKey,
      airroiIdToRecords,
      null
    );

    // Update compset summaries
    for (const listingId of affectedListingIds) {
      await updateCompsetSummary(supabase, listingId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        api_calls_made: airroiIdToRecords.size,
        records_updated: recordsUpdated,
        failed: errors.length,
        total_records: comparables.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in fetch-comparable-metrics:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
