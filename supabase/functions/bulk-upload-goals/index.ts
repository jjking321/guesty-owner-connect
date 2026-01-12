import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MonthlyProjections {
  [month: number]: number;
}

interface GoalUpdate {
  listingId: string;
  monthlyProjections: MonthlyProjections;
}

interface BulkUploadRequest {
  year: number;
  updates: GoalUpdate[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { year, updates }: BulkUploadRequest = await req.json();

    console.log(`Processing bulk upload for year ${year}, ${updates.length} properties`);

    // Build array of all goals to upsert
    const goalsToUpsert = [];
    const listingIds: string[] = [];

    for (const update of updates) {
      const { listingId, monthlyProjections } = update;
      listingIds.push(listingId);

      for (const [monthStr, projection] of Object.entries(monthlyProjections)) {
        const month = parseInt(monthStr);

        goalsToUpsert.push({
          listing_id: listingId,
          year,
          month,
          projection_revenue: projection,
          locked: true,
          locked_by: user.id,
          locked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(`Prepared ${goalsToUpsert.length} goals for upsert`);

    // Fetch all existing locked goals in one query
    const { data: lockedGoals } = await supabaseClient
      .from('property_goals')
      .select('listing_id, month')
      .eq('year', year)
      .in('listing_id', listingIds)
      .eq('locked', true);

    const lockedSet = new Set(
      lockedGoals?.map(g => `${g.listing_id}-${g.month}`) || []
    );

    // Filter out locked goals
    const goalsToInsert = goalsToUpsert.filter(
      g => !lockedSet.has(`${g.listing_id}-${g.month}`)
    );

    const goalsSkipped = goalsToUpsert.length - goalsToInsert.length;
    console.log(`Skipping ${goalsSkipped} locked goals, upserting ${goalsToInsert.length} goals`);

    // Batch upsert in chunks of 500 to avoid payload limits
    const BATCH_SIZE = 500;
    let goalsUpdated = 0;
    const errors: string[] = [];

    for (let i = 0; i < goalsToInsert.length; i += BATCH_SIZE) {
      const batch = goalsToInsert.slice(i, i + BATCH_SIZE);
      
      try {
        const { error: upsertError } = await supabaseClient
          .from('property_goals')
          .upsert(batch, {
            onConflict: 'listing_id,year,month',
          });

        if (upsertError) {
          console.error(`Batch upsert error:`, upsertError);
          errors.push(`Batch ${i / BATCH_SIZE + 1}: ${upsertError.message}`);
        } else {
          goalsUpdated += batch.length;
          console.log(`Upserted batch ${i / BATCH_SIZE + 1}: ${batch.length} goals`);
        }
      } catch (error) {
        console.error(`Batch processing error:`, error);
        errors.push(`Batch ${i / BATCH_SIZE + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const response = {
      success: true,
      stats: {
        propertiesProcessed: updates.length,
        goalsUpdated,
        goalsSkipped,
        errors: errors.length > 0 ? errors.slice(0, 10) : [], // Return first 10 errors
      },
    };

    console.log('Bulk upload completed:', response.stats);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
