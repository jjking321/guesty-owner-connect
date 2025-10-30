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

    let goalsUpdated = 0;
    let goalsSkipped = 0;
    const errors: string[] = [];

    // Process each listing
    for (const update of updates) {
      const { listingId, monthlyProjections } = update;

      // Process each month for this listing
      for (const [monthStr, projection] of Object.entries(monthlyProjections)) {
        const month = parseInt(monthStr);

        try {
          // Check if goal exists and is locked
          const { data: existingGoal } = await supabaseClient
            .from('property_goals')
            .select('id, locked')
            .eq('listing_id', listingId)
            .eq('year', year)
            .eq('month', month)
            .single();

          // Skip if already locked (preserve user locks)
          if (existingGoal?.locked) {
            console.log(`Skipping locked goal: ${listingId}, month ${month}`);
            goalsSkipped++;
            continue;
          }

          // Calculate budget and goal from projection
          const budget = Math.round(projection * 0.8 * 100) / 100;
          const goal = Math.round(projection * 1.1 * 100) / 100;

          // Upsert the goal
          const { error: upsertError } = await supabaseClient
            .from('property_goals')
            .upsert(
              {
                listing_id: listingId,
                year,
                month,
                projection_revenue: projection,
                budget_revenue: budget,
                goal_revenue: goal,
                locked: true,
                locked_by: user.id,
                locked_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: 'listing_id,year,month',
              }
            );

          if (upsertError) {
            console.error(`Error upserting goal for ${listingId}, month ${month}:`, upsertError);
            errors.push(`${listingId} month ${month}: ${upsertError.message}`);
          } else {
            goalsUpdated++;
          }
        } catch (error) {
          console.error(`Error processing ${listingId}, month ${month}:`, error);
          errors.push(`${listingId} month ${month}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
