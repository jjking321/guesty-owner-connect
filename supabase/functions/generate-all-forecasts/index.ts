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
    console.log('Starting weekly forecast generation for all properties...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const currentYear = new Date().getFullYear();

    // Get all active listings
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('active', true)
      .eq('is_listed', true);

    if (listingsError) {
      console.error('Error fetching listings:', listingsError);
      throw listingsError;
    }

    console.log(`Found ${listings?.length || 0} active listings to process`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each listing
    for (const listing of listings || []) {
      try {
        console.log(`Generating forecast for ${listing.nickname || listing.id}...`);

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
          successCount++;
          console.log(`✓ Forecast generated for ${listing.nickname || listing.id}`);
          results.push({
            listingId: listing.id,
            nickname: listing.nickname,
            status: 'success'
          });
        } else {
          errorCount++;
          const errorText = await response.text();
          console.error(`✗ Failed to generate forecast for ${listing.nickname || listing.id}: ${errorText}`);
          results.push({
            listingId: listing.id,
            nickname: listing.nickname,
            status: 'error',
            error: errorText
          });
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Error processing ${listing.nickname || listing.id}:`, error);
        results.push({
          listingId: listing.id,
          nickname: listing.nickname,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`Forecast generation complete: ${successCount} succeeded, ${errorCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        totalListings: listings?.length || 0,
        successCount,
        errorCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-all-forecasts:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
