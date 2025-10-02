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

    console.log('Starting weekly forecast generation for all properties...');

    // Get all active listings
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('active', true);

    if (listingsError) throw listingsError;

    console.log(`Found ${listings?.length || 0} active properties`);

    const results = [];
    const currentYear = new Date().getFullYear();

    // Generate forecast for each listing
    for (const listing of listings || []) {
      try {
        console.log(`Generating forecast for ${listing.nickname} (${listing.id})`);
        
        // Call the forecast-revenue function
        const response = await fetch(`${supabaseUrl}/functions/v1/forecast-revenue`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            listingId: listing.id,
            year: currentYear,
            simulations: 10000
          })
        });

        if (response.ok) {
          const data = await response.json();
          results.push({
            listing_id: listing.id,
            nickname: listing.nickname,
            status: 'success',
            forecast: data.totalForecast.p50
          });
          console.log(`✓ Forecast generated for ${listing.nickname}: $${data.totalForecast.p50.toFixed(0)}`);
        } else {
          const error = await response.text();
          results.push({
            listing_id: listing.id,
            nickname: listing.nickname,
            status: 'error',
            error
          });
          console.error(`✗ Failed for ${listing.nickname}:`, error);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          listing_id: listing.id,
          nickname: listing.nickname,
          status: 'error',
          error: errorMessage
        });
        console.error(`✗ Error for ${listing.nickname}:`, error);
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failureCount = results.filter(r => r.status === 'error').length;

    console.log(`Forecast generation complete: ${successCount} success, ${failureCount} failures`);

    return new Response(
      JSON.stringify({
        success: true,
        total: listings?.length || 0,
        successful: successCount,
        failed: failureCount,
        results
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
