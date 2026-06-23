import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    // Auth: accept service-role bearer (internal invocations) or a valid user JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isServiceRole = bearer.length > 0 && bearer === supabaseKey;

    let userId: string | undefined;
    if (!isServiceRole) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
      if (userError || !userData?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      userId = userData.user.id;
    }

    console.log('Starting background probability calculation for all properties...');

    // Get all active listings (exclude archived, only listed properties)
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('is_listed', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    const totalListings = listings?.length || 0;
    console.log(`Found ${totalListings} active properties - processing in background`);

    // Create progress tracking record (reuse forecast_generation_progress table)
    const { data: progressRecord, error: progressError } = await supabase
      .from('forecast_generation_progress')
      .insert({
        total_forecasts: totalListings, // Using this field for total count
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
      const BATCH_SIZE = 10;
      let successCount = 0;
      let failureCount = 0;

      // Process in batches
      for (let i = 0; i < (listings || []).length; i += BATCH_SIZE) {
        const batch = (listings || []).slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalListings / BATCH_SIZE)}`);

        const batchPromises = batch.map(listing =>
          supabase.functions.invoke('calculate-booking-probabilities', {
            body: { listingId: listing.id }
          }).then(({ data, error }) => {
            if (error) {
              console.error(`✗ Probability for ${listing.nickname}:`, error);
              return { success: false, listing };
            }
            console.log(`✓ Probability for ${listing.nickname}: ${data?.datesProcessed || 0} dates`);
            return { success: true, listing };
          }).catch(err => {
            console.error(`✗ Error for ${listing.nickname}:`, err);
            return { success: false, listing };
          })
        );

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

        // Small delay between batches to avoid overwhelming the system
        if (i + BATCH_SIZE < (listings || []).length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`Background probability calculation complete: ${successCount} success, ${failureCount} failures out of ${totalListings} total`);

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
        message: 'Probability calculation started in background',
        progress_id: progressId,
        total_listings: totalListings,
        estimated_duration_minutes: Math.ceil(totalListings / 10 * 2)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in calculate-all-probabilities:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
