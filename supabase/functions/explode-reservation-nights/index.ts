import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting reservation nights explosion process...');

    // Get all confirmed and checked-out reservations
    const { data: reservations, error: fetchError } = await supabase
      .from('reservations')
      .select('id, listing_id, check_in, check_out, fare_accommodation_adjusted, nights_count')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .not('check_in', 'is', null)
      .not('check_out', 'is', null)
      .not('nights_count', 'is', null)
      .gt('nights_count', 0);

    if (fetchError) {
      console.error('Error fetching reservations:', fetchError);
      throw fetchError;
    }

    console.log(`Processing ${reservations?.length || 0} reservations...`);

    let processedCount = 0;
    let errorCount = 0;
    const batchSize = 100;

    for (let i = 0; i < (reservations?.length || 0); i += batchSize) {
      const batch = reservations!.slice(i, i + batchSize);
      const nightsToInsert = [];

      for (const reservation of batch) {
        try {
          const checkIn = new Date(reservation.check_in);
          const checkOut = new Date(reservation.check_out);
          const nightsCount = reservation.nights_count;
          const totalRevenue = parseFloat(reservation.fare_accommodation_adjusted || '0');
          const revenuePerNight = nightsCount > 0 ? totalRevenue / nightsCount : 0;

          // Generate records for each night
          for (let nightIndex = 0; nightIndex < nightsCount; nightIndex++) {
            const nightDate = new Date(checkIn);
            nightDate.setDate(nightDate.getDate() + nightIndex);

            nightsToInsert.push({
              reservation_id: reservation.id,
              listing_id: reservation.listing_id,
              night_date: nightDate.toISOString().split('T')[0],
              revenue_allocation: revenuePerNight
            });
          }
        } catch (error) {
          console.error(`Error processing reservation ${reservation.id}:`, error);
          errorCount++;
        }
      }

      // Batch insert nights
      if (nightsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('reservation_nights')
          .upsert(nightsToInsert, { onConflict: 'reservation_id,night_date' });

        if (insertError) {
          console.error('Error inserting nights batch:', insertError);
          errorCount += nightsToInsert.length;
        } else {
          processedCount += batch.length;
        }
      }

      console.log(`Progress: ${Math.min(i + batchSize, reservations!.length)}/${reservations!.length} reservations processed`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Reservation nights explosion completed',
        stats: {
          totalReservations: reservations?.length || 0,
          processedCount,
          errorCount
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in explode-reservation-nights:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
