import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AIRROI_API_URL = 'https://api.airroi.com/listings/metrics/all';

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

    // Fetch the comparables to get their airroi_listing_ids
    // Cast airroi_listing_id to text to avoid JavaScript BigInt precision loss
    const { data: comparables, error: fetchError } = await supabase
      .from('property_comparables')
      .select('id, airroi_listing_id::text')
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

        // Update the comparable with the historical metrics
        const { error: updateError } = await supabase
          .from('property_comparables')
          .update({
            historical_metrics: metricsData,
            metrics_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', comparable.id);

        if (updateError) {
          console.error(`Failed to update comparable ${comparable.id}: ${updateError.message}`);
          errors.push(`Update ${comparable.id}: ${updateError.message}`);
          failedCount++;
        } else {
          console.log(`Successfully updated metrics for comparable ${comparable.id}`);
          successCount++;
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
