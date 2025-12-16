import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DBABucket {
  min: number;
  max: number;
  label: string;
}

const DEFAULT_DBA_BUCKETS: DBABucket[] = [
  { min: 0, max: 3, label: '0-3' },
  { min: 4, max: 7, label: '4-7' },
  { min: 8, max: 14, label: '8-14' },
  { min: 15, max: 30, label: '15-30' },
  { min: 31, max: 60, label: '31-60' },
  { min: 61, max: 90, label: '61-90' },
  { min: 91, max: 180, label: '91-180' },
  { min: 181, max: 365, label: '181+' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting booking curves generation...');

    // Get forecast settings
    const { data: settings } = await supabase
      .from('forecast_settings')
      .select('*')
      .limit(1)
      .single();

    const dbaBuckets = settings?.dba_buckets || DEFAULT_DBA_BUCKETS.map(b => [b.min, b.max]);
    const minHistoryMonths = settings?.min_history_months || 24;

    // Calculate the date range for historical data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - minHistoryMonths);

    console.log(`Analyzing reservations from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Get all active listings
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id')
      .eq('active', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    console.log(`Processing ${listings?.length || 0} listings...`);

    let processedListings = 0;

    for (const listing of listings || []) {
      try {
        // Get reservations for this listing with created_at info
        // Exclude owner reservations from calculations
        const { data: reservations, error: resError } = await supabase
          .from('reservations')
          .select('id, check_in, fare_accommodation_adjusted, created_at_guesty')
          .eq('listing_id', listing.id)
          .in('status', ['confirmed', 'checked_in', 'checked_out'])
          .neq('source', 'owner')
          .gte('check_in', startDate.toISOString())
          .lte('check_in', endDate.toISOString())
          .not('created_at_guesty', 'is', null);

        if (resError) {
          console.error(`Error fetching reservations for listing ${listing.id}:`, resError);
          continue;
        }

        if (!reservations || reservations.length === 0) {
          console.log(`No reservations found for listing ${listing.id}`);
          continue;
        }

        // Group reservations by year-month of check-in
        const monthlyData: Record<string, any[]> = {};
        
        for (const res of reservations) {
          const checkIn = new Date(res.check_in);
          const yearMonth = `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}`;
          
          if (!monthlyData[yearMonth]) {
            monthlyData[yearMonth] = [];
          }
          
          monthlyData[yearMonth].push(res);
        }

        // Process each month
        const curvesToInsert = [];

        for (const [yearMonth, monthReservations] of Object.entries(monthlyData)) {
          if (monthReservations.length < 3) {
            console.log(`Skipping ${yearMonth} for listing ${listing.id} - insufficient data (${monthReservations.length} reservations)`);
            continue;
          }

          const totalMonthRevenue = monthReservations.reduce(
            (sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || '0'),
            0
          );

          // Calculate DBA for each reservation and bucket them
          for (const bucket of dbaBuckets) {
            const bucketLabel = `${bucket[0]}-${bucket[1]}`;
            const bucketReservations = [];

            for (const res of monthReservations) {
              const checkIn = new Date(res.check_in);
              const createdAt = new Date(res.created_at_guesty);
              const dba = Math.floor((checkIn.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

              if (dba >= bucket[0] && (bucket[1] >= 365 ? dba >= bucket[0] : dba <= bucket[1])) {
                bucketReservations.push(res);
              }
            }

            const bucketRevenue = bucketReservations.reduce(
              (sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || '0'),
              0
            );

            const pickupShare = totalMonthRevenue > 0 ? bucketRevenue / totalMonthRevenue : 0;
            const pickupAmountMean = bucketReservations.length > 0 ? bucketRevenue / bucketReservations.length : 0;

            // Calculate standard deviation
            let pickupAmountStddev = 0;
            if (bucketReservations.length > 1) {
              const mean = pickupAmountMean;
              const variance = bucketReservations.reduce((sum, r) => {
                const val = parseFloat(r.fare_accommodation_adjusted || '0');
                return sum + Math.pow(val - mean, 2);
              }, 0) / bucketReservations.length;
              pickupAmountStddev = Math.sqrt(variance);
            }

            curvesToInsert.push({
              listing_id: listing.id,
              year_month: yearMonth,
              dba_bucket: bucketLabel,
              pickup_share: pickupShare,
              pickup_amount_mean: pickupAmountMean,
              pickup_amount_stddev: pickupAmountStddev,
              sample_size: bucketReservations.length
            });
          }
        }

        // Insert booking curves
        if (curvesToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from('booking_curves')
            .upsert(curvesToInsert, { onConflict: 'listing_id,year_month,dba_bucket' });

          if (insertError) {
            console.error(`Error inserting curves for listing ${listing.id}:`, insertError);
          }
        }

        processedListings++;
        if (processedListings % 10 === 0) {
          console.log(`Progress: ${processedListings}/${listings.length} listings processed`);
        }
      } catch (error) {
        console.error(`Error processing listing ${listing.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Booking curves generated successfully',
        stats: {
          totalListings: listings?.length || 0,
          processedListings
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in build-booking-curves:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
