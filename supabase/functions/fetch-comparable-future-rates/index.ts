import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/future/rates';

interface FutureRateDay {
  date: string;
  available: boolean;
  rate: number;
}

interface MonthlyAverage {
  month: string;
  adr: number;
  occupancy: number;
  revpar: number;
}

function aggregateFutureRatesToMonthly(comparablesWithRates: any[]): MonthlyAverage[] {
  const monthlyData = new Map<string, { totalRate: number; rateCount: number; bookedDays: number; totalDays: number }>();

  for (const comparable of comparablesWithRates) {
    const futureRates = comparable.future_rates;
    if (!futureRates || !Array.isArray(futureRates.rates)) continue;

    for (const day of futureRates.rates as FutureRateDay[]) {
      if (!day.date) continue;
      
      const monthKey = day.date.substring(0, 7);
      
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { totalRate: 0, rateCount: 0, bookedDays: 0, totalDays: 0 });
      }
      
      const data = monthlyData.get(monthKey)!;
      data.totalDays++;
      
      if (day.rate && day.rate > 0) {
        data.totalRate += day.rate;
        data.rateCount++;
      }
      
      if (!day.available) {
        data.bookedDays++;
      }
    }
  }

  const result: MonthlyAverage[] = [];
  const sortedMonths = Array.from(monthlyData.keys()).sort();
  
  for (const month of sortedMonths) {
    const data = monthlyData.get(month)!;
    const adr = data.rateCount > 0 ? data.totalRate / data.rateCount : 0;
    const occupancy = data.totalDays > 0 ? data.bookedDays / data.totalDays : 0;
    const revpar = adr * occupancy;
    
    result.push({ month, adr, occupancy, revpar });
  }

  return result;
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
      console.log(`Fetching future rates for airroi_listing_id: ${airroiListingId} (affects ${records.length} records)`);

      const url = `${AIRROI_API_URL}?id=${airroiListingId}&currency=usd`;
      
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

      const ratesData = await response.json();
      console.log(`Received future rates data for ${airroiListingId}`);

      // Update ALL records that share this airroi_listing_id IMMEDIATELY (save as we go)
      const recordIds = records.map(r => r.id);
      const { error: updateError } = await supabase
        .from('property_comparables')
        .update({
          future_rates: ratesData,
          future_rates_fetched_at: new Date().toISOString(),
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
            progress_message: `Fetched future rates for ${successCount}/${totalItems} comparables`,
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

async function updateCompsetFutureAverages(supabase: any, affectedListingIds: Set<string>, errors: string[]): Promise<void> {
  console.log(`Aggregating future rates for ${affectedListingIds.size} affected listings`);

  for (const listingId of affectedListingIds) {
    try {
      const { data: selectedComparables, error: selectError } = await supabase
        .from('property_comparables')
        .select('future_rates')
        .eq('listing_id', listingId)
        .eq('is_selected', true)
        .not('future_rates', 'is', null);

      if (selectError) {
        console.error(`Failed to fetch selected comparables for listing ${listingId}: ${selectError.message}`);
        errors.push(`Aggregation ${listingId}: ${selectError.message}`);
        continue;
      }

      if (selectedComparables && selectedComparables.length > 0) {
        const futureMonthlyAverages = aggregateFutureRatesToMonthly(selectedComparables);
        console.log(`Calculated ${futureMonthlyAverages.length} months of future averages for listing ${listingId}`);

        const { error: upsertError } = await supabase
          .from('property_compset_summary')
          .upsert({
            listing_id: listingId,
            future_monthly_averages: futureMonthlyAverages,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'listing_id' });

        if (upsertError) {
          console.error(`Failed to upsert future monthly averages for listing ${listingId}: ${upsertError.message}`);
          errors.push(`Aggregation ${listingId}: ${upsertError.message}`);
        } else {
          console.log(`Successfully stored future monthly averages for listing ${listingId}`);
        }
      }
    } catch (error: any) {
      console.error(`Error updating future averages for ${listingId}:`, error);
      errors.push(`Aggregation ${listingId}: ${error.message}`);
    }
  }
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

    console.log(`Fetching future rates for ${comparable_ids.length} comparables`);

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

    // Deduplicate by airroi_listing_id
    const airroiIdToRecords = new Map<string, Array<{ id: string; listing_id: string }>>();
    
    for (const comparable of comparables) {
      const key = comparable.airroi_listing_id;
      if (!airroiIdToRecords.has(key)) {
        airroiIdToRecords.set(key, []);
      }
      airroiIdToRecords.get(key)!.push({
        id: comparable.id,
        listing_id: comparable.listing_id
      });
    }

    console.log(`Deduplicated ${comparables.length} records to ${airroiIdToRecords.size} unique API calls`);

    // If guesty_account_id provided, create sync job and process in background
    if (guesty_account_id) {
      const { data: syncJob, error: jobError } = await supabase
        .from('sync_jobs')
        .insert({
          guesty_account_id,
          sync_type: 'comparable_future_rates',
          status: 'running',
          total_items: airroiIdToRecords.size,
          items_synced: 0,
          progress_message: `Starting future rates fetch for ${airroiIdToRecords.size} comparables...`,
        })
        .select()
        .single();

      if (jobError) {
        console.error('Error creating sync job:', jobError);
      } else {
        console.log(`Created sync job ${syncJob.id}`);

        // Process in background
        EdgeRuntime.waitUntil((async () => {
          const allErrors: string[] = [];
          try {
            const { successCount, recordsUpdated, errors, affectedListingIds } = await processComparables(
              supabase,
              airroiApiKey,
              airroiIdToRecords,
              syncJob.id
            );
            allErrors.push(...errors);

            // Update compset summaries
            await updateCompsetFutureAverages(supabase, affectedListingIds, allErrors);

            // Mark job as completed
            await supabase
              .from('sync_jobs')
              .update({
                status: allErrors.length > 0 ? 'completed_with_errors' : 'completed',
                completed_at: new Date().toISOString(),
                items_synced: successCount,
                progress_message: `Completed: ${successCount}/${airroiIdToRecords.size} API calls, ${recordsUpdated} records updated`,
                error_message: allErrors.length > 0 ? allErrors.slice(0, 5).join('; ') : null,
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
            message: `Started fetching future rates for ${airroiIdToRecords.size} comparables`,
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
    await updateCompsetFutureAverages(supabase, affectedListingIds, errors);

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
    console.error('Error in fetch-comparable-future-rates:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
