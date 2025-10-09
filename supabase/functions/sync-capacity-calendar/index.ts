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

    console.log('Starting capacity calendar sync...');

    // Get all active listings
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id')
      .eq('active', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    console.log(`Processing ${listings?.length || 0} listings...`);

    // Generate capacity calendar for next 365 days
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 365);

    let processedCount = 0;

    for (const listing of listings || []) {
      const capacityRecords = [];
      
      // Generate a record for each day
      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        capacityRecords.push({
          listing_id: listing.id,
          date: date.toISOString().split('T')[0],
          is_available: true, // Default to available; will be updated based on blocks/reservations
          block_reason: null
        });
      }

      // Batch insert
      const batchSize = 500;
      for (let i = 0; i < capacityRecords.length; i += batchSize) {
        const batch = capacityRecords.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('capacity_calendar')
          .upsert(batch, { onConflict: 'listing_id,date' });

        if (insertError) {
          console.error(`Error inserting capacity for listing ${listing.id}:`, insertError);
        }
      }

      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`Progress: ${processedCount}/${listings.length} listings processed`);
      }
    }

    // Now mark dates with reservations as unavailable
    console.log('Marking reserved dates as unavailable...');
    
    const { data: reservations } = await supabase
      .from('reservations')
      .select('listing_id, check_in, check_out')
      .in('status', ['confirmed', 'checked_in'])
      .gte('check_out', startDate.toISOString())
      .lte('check_in', endDate.toISOString());

    for (const reservation of reservations || []) {
      const checkIn = new Date(reservation.check_in);
      const checkOut = new Date(reservation.check_out);

      // Mark each night as unavailable
      for (let date = new Date(checkIn); date < checkOut; date.setDate(date.getDate() + 1)) {
        await supabase
          .from('capacity_calendar')
          .update({ is_available: false, block_reason: 'reservation' })
          .eq('listing_id', reservation.listing_id)
          .eq('date', date.toISOString().split('T')[0]);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Capacity calendar synced successfully',
        stats: {
          totalListings: listings?.length || 0,
          processedCount,
          daysGenerated: 365
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in sync-capacity-calendar:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
