import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const currentYear = new Date().getFullYear()
    const nextYear = currentYear + 1

    console.log(`Finding listings missing forecasts for ${currentYear} and ${nextYear}...`)

    // Get all active, non-archived listings
    const { data: allListings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname, address')
      .eq('active', true)
      .eq('archived', false)

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`)
    }

    console.log(`Found ${allListings?.length || 0} active listings`)

    // Get existing forecasts for current and next year
    const { data: existingForecasts, error: forecastsError } = await supabase
      .from('revenue_forecasts')
      .select('listing_id, year')
      .in('year', [currentYear, nextYear])

    if (forecastsError) {
      throw new Error(`Failed to fetch existing forecasts: ${forecastsError.message}`)
    }

    console.log(`Found ${existingForecasts?.length || 0} existing forecasts`)

    // Create a set of listing_id + year combinations that already have forecasts
    const existingForecastKeys = new Set(
      existingForecasts?.map(f => `${f.listing_id}-${f.year}`) || []
    )

    // Filter to listings that are missing at least one forecast (current or next year)
    const listingsMissingForecasts = allListings?.filter(listing => {
      const hasCurrentYear = existingForecastKeys.has(`${listing.id}-${currentYear}`)
      const hasNextYear = existingForecastKeys.has(`${listing.id}-${nextYear}`)
      return !hasCurrentYear || !hasNextYear
    }) || []

    console.log(`Found ${listingsMissingForecasts.length} listings missing forecasts`)

    if (listingsMissingForecasts.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'All listings already have forecasts',
          properties_processed: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Start background task to generate missing forecasts
    const backgroundTask = async () => {
      console.log(`Starting background forecast generation for ${listingsMissingForecasts.length} listings...`)
      
      const batchSize = 10
      let totalGenerated = 0
      let totalFailed = 0

      for (let i = 0; i < listingsMissingForecasts.length; i += batchSize) {
        const batch = listingsMissingForecasts.slice(i, i + batchSize)
        console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(listingsMissingForecasts.length / batchSize)} (${batch.length} listings)`)

        const batchPromises = batch.flatMap(listing => {
          const nickname = listing.nickname || listing.address?.full || listing.id
          const forecasts = []

          // Only generate for years that are missing
          if (!existingForecastKeys.has(`${listing.id}-${currentYear}`)) {
            console.log(`Generating ${currentYear} forecast for ${nickname} (${listing.id})`)
            forecasts.push(
              supabase.functions.invoke('forecast-revenue', {
                body: {
                  listingId: listing.id,
                  year: currentYear,
                  simulations: 1000
                }
              })
              .then(result => {
                if (result.error) {
                  console.error(`✗ ${currentYear} forecast failed for ${nickname}:`, result.error)
                  return { status: 'failed', listing: nickname, year: currentYear, error: result.error }
                }
                const revenue = result.data?.forecast?.totalForecast?.p50 || 0
                console.log(`✓ ${currentYear} forecast for ${nickname}: $${Math.round(revenue)}`)
                return { status: 'success', listing: nickname, year: currentYear }
              })
              .catch(error => {
                console.error(`✗ ${currentYear} forecast error for ${nickname}:`, error)
                return { status: 'failed', listing: nickname, year: currentYear, error }
              })
            )
          }

          if (!existingForecastKeys.has(`${listing.id}-${nextYear}`)) {
            console.log(`Generating ${nextYear} forecast for ${nickname} (${listing.id})`)
            forecasts.push(
              supabase.functions.invoke('forecast-revenue', {
                body: {
                  listingId: listing.id,
                  year: nextYear,
                  simulations: 1000
                }
              })
              .then(result => {
                if (result.error) {
                  console.error(`✗ ${nextYear} forecast failed for ${nickname}:`, result.error)
                  return { status: 'failed', listing: nickname, year: nextYear, error: result.error }
                }
                const revenue = result.data?.forecast?.totalForecast?.p50 || 0
                console.log(`✓ ${nextYear} forecast for ${nickname}: $${Math.round(revenue)}`)
                return { status: 'success', listing: nickname, year: nextYear }
              })
              .catch(error => {
                console.error(`✗ ${nextYear} forecast error for ${nickname}:`, error)
                return { status: 'failed', listing: nickname, year: nextYear, error }
              })
            )
          }

          return forecasts
        })

        const results = await Promise.allSettled(batchPromises)
        
        const batchSuccesses = results.filter(r => 
          r.status === 'fulfilled' && r.value.status === 'success'
        ).length
        const batchFailures = results.filter(r => 
          r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')
        ).length

        totalGenerated += batchSuccesses
        totalFailed += batchFailures

        console.log(`Batch complete: ${batchSuccesses} succeeded, ${batchFailures} failed`)
      }

      console.log(`\n=== Background forecast generation complete ===`)
      console.log(`Total generated: ${totalGenerated}`)
      console.log(`Total failed: ${totalFailed}`)
      console.log(`Properties processed: ${listingsMissingForecasts.length}`)
    }

    // Start background task without awaiting
    EdgeRuntime.waitUntil(backgroundTask())

    // Return immediate response
    return new Response(
      JSON.stringify({ 
        message: 'Forecast generation started in background',
        properties_processed: listingsMissingForecasts.length,
        estimated_duration_minutes: Math.ceil(listingsMissingForecasts.length * 2 / 10) // ~2 min per 10 properties
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error in generate-missing-forecasts:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
