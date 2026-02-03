import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for service-role bypass (for automated nightly sync)
    const isServiceRole = req.headers.get("x-service-role") === "true";

    let userId: string | undefined;

    if (!isServiceRole) {
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '');
      const { data: userData } = await supabase.auth.getUser(token || '');
      userId = userData?.user?.id;
    }
    // For service-role, userId remains undefined but that's fine for automated runs

    console.log('Starting background forecast generation for all properties...');

    // Get all active listings (exclude archived, only listed properties)
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('is_listed', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    const totalProperties = listings?.length || 0;
    const totalForecasts = totalProperties * 2;
    console.log(`Found ${totalProperties} active properties - processing in background`);

    // Create progress tracking record
    const { data: progressRecord, error: progressError } = await supabase
      .from('forecast_generation_progress')
      .insert({
        total_forecasts: totalForecasts,
        completed_forecasts: 0,
        failed_forecasts: 0,
        status: 'running',
        created_by: userId
      })
      .select()
      .single();

    if (progressError) {
      console.error('Error creating progress record:', progressError);
    }

    const progressId = progressRecord?.id;

    // Start background task
    const backgroundTask = async () => {
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;
      const BATCH_SIZE = 10;
      let successCount = 0;
      let failureCount = 0;

      // Process in batches
      for (let i = 0; i < (listings || []).length; i += BATCH_SIZE) {
        const batch = (listings || []).slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalProperties / BATCH_SIZE)}`);

        const batchPromises = batch.flatMap(listing => [
          // Current year forecast
          supabase.functions.invoke('forecast-revenue', {
            body: {
              listingId: listing.id,
              year: currentYear,
              simulations: 10000
            }
          }).then(({ data, error }) => {
            if (error) {
              console.error(`✗ ${currentYear} for ${listing.nickname}:`, error);
              return { success: false, listing, year: currentYear };
            }
            console.log(`✓ ${currentYear} forecast for ${listing.nickname}: $${data?.totalForecast?.p50?.toFixed(0) || 0}`);
            return { success: true, listing, year: currentYear };
          }).catch(err => {
            console.error(`✗ Error ${currentYear} for ${listing.nickname}:`, err);
            return { success: false, listing, year: currentYear };
          }),
          
          // Next year forecast
          supabase.functions.invoke('forecast-revenue', {
            body: {
              listingId: listing.id,
              year: nextYear,
              simulations: 10000
            }
          }).then(({ data, error }) => {
            if (error) {
              console.error(`✗ ${nextYear} for ${listing.nickname}:`, error);
              return { success: false, listing, year: nextYear };
            }
            console.log(`✓ ${nextYear} forecast for ${listing.nickname}: $${data?.totalForecast?.p50?.toFixed(0) || 0}`);
            return { success: true, listing, year: nextYear };
          }).catch(err => {
            console.error(`✗ Error ${nextYear} for ${listing.nickname}:`, err);
            return { success: false, listing, year: nextYear };
          })
        ]);

        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value.success) {
            successCount++;
          } else {
            failureCount++;
          }
        });

        console.log(`Batch complete. Progress: ${successCount} success, ${failureCount} failures`);

        // Update progress
        if (progressId) {
          await supabase
            .from('forecast_generation_progress')
            .update({
              completed_forecasts: successCount,
              failed_forecasts: failureCount
            })
            .eq('id', progressId);
        }
      }

      console.log(`Background forecast generation complete: ${successCount} success, ${failureCount} failures out of ${totalProperties * 2} total forecasts`);

      // Mark progress as complete
      if (progressId) {
        await supabase
          .from('forecast_generation_progress')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_forecasts: successCount,
            failed_forecasts: failureCount
          })
          .eq('id', progressId);
      }
    };

    // Run in background using EdgeRuntime.waitUntil
    // @ts-ignore - EdgeRuntime is available in Deno edge runtime
    EdgeRuntime.waitUntil(backgroundTask());

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Forecast generation started in background',
        progress_id: progressId,
        total_properties: totalProperties,
        total_forecasts: totalForecasts,
        estimated_duration_minutes: Math.ceil(totalProperties / 10 * 2)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in generate-all-forecasts:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
