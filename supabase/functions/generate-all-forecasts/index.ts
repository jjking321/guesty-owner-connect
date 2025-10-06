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

    // Get all active listings (exclude archived)
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('active', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    console.log(`Found ${listings?.length || 0} active properties`);

    const results = [];
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;

    // Generate forecast for each listing (both current and next year)
    for (const listing of listings || []) {
      // Generate for current year
      try {
        console.log(`Generating ${currentYear} forecast for ${listing.nickname} (${listing.id})`);
        
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
            year: currentYear,
            status: 'success',
            forecast: data.totalForecast.p50
          });
          console.log(`✓ ${currentYear} forecast for ${listing.nickname}: $${data.totalForecast.p50.toFixed(0)}`);
        } else {
          const error = await response.text();
          results.push({
            listing_id: listing.id,
            nickname: listing.nickname,
            year: currentYear,
            status: 'error',
            error
          });
          console.error(`✗ Failed ${currentYear} for ${listing.nickname}:`, error);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          listing_id: listing.id,
          nickname: listing.nickname,
          year: currentYear,
          status: 'error',
          error: errorMessage
        });
        console.error(`✗ Error ${currentYear} for ${listing.nickname}:`, error);
      }

      // Generate for next year
      try {
        console.log(`Generating ${nextYear} forecast for ${listing.nickname} (${listing.id})`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/forecast-revenue`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            listingId: listing.id,
            year: nextYear,
            simulations: 10000
          })
        });

        if (response.ok) {
          const data = await response.json();
          results.push({
            listing_id: listing.id,
            nickname: listing.nickname,
            year: nextYear,
            status: 'success',
            forecast: data.totalForecast.p50
          });
          console.log(`✓ ${nextYear} forecast for ${listing.nickname}: $${data.totalForecast.p50.toFixed(0)}`);
        } else {
          const error = await response.text();
          results.push({
            listing_id: listing.id,
            nickname: listing.nickname,
            year: nextYear,
            status: 'error',
            error
          });
          console.error(`✗ Failed ${nextYear} for ${listing.nickname}:`, error);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          listing_id: listing.id,
          nickname: listing.nickname,
          year: nextYear,
          status: 'error',
          error: errorMessage
        });
        console.error(`✗ Error ${nextYear} for ${listing.nickname}:`, error);
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
