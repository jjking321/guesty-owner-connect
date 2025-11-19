import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Verify the user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { year = 2025 } = await req.json();

    console.log(`Starting goal recalculation for year ${year} by user ${user.id}`);

    // Fetch user's organizations
    const { data: userOrgs, error: orgError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id);

    if (orgError) {
      throw new Error(`Failed to fetch user organizations: ${orgError.message}`);
    }

    if (!userOrgs || userOrgs.length === 0) {
      throw new Error('User is not a member of any organization');
    }

    const orgIds = userOrgs.map(org => org.organization_id);

    // Get guesty accounts in user's organizations
    const { data: guestyAccounts, error: guestyError } = await supabase
      .from('guesty_accounts')
      .select('id')
      .in('organization_id', orgIds);

    if (guestyError) {
      throw new Error(`Failed to fetch guesty accounts: ${guestyError.message}`);
    }

    const guestyAccountIds = guestyAccounts?.map(ga => ga.id) || [];

    if (guestyAccountIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No guesty accounts found for user'
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Get the first guesty account for tracking purposes
    const guestyAccountId = guestyAccountIds[0];

    // Get all listings in user's organizations
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id')
      .in('guesty_account_id', guestyAccountIds);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    const listingIds = listings?.map(l => l.id) || [];

    if (listingIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No listings found for user'
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Count total goals to process
    const { count: totalGoals, error: countError } = await supabase
      .from('property_goals')
      .select('*', { count: 'exact', head: true })
      .eq('year', year)
      .in('listing_id', listingIds);

    if (countError) {
      throw new Error(`Failed to count goals: ${countError.message}`);
    }

    if (!totalGoals || totalGoals === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `No goals found for year ${year}`
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create sync job
    const { data: syncJob, error: syncJobError } = await supabase
      .from('sync_jobs')
      .insert({
        guesty_account_id: guestyAccountId,
        sync_type: 'goal_recalculation',
        status: 'running',
        progress_message: 'Starting goal recalculation...',
        total_items: totalGoals,
        items_synced: 0,
      })
      .select()
      .single();

    if (syncJobError || !syncJob) {
      throw new Error(`Failed to create sync job: ${syncJobError?.message}`);
    }

    console.log(`Created sync job ${syncJob.id} for ${totalGoals} goals`);

    // Start background task
    const backgroundTask = async () => {
      try {
        // Fetch all property_goals for the year and user's listings
        const { data: goals, error: goalsError } = await supabase
          .from('property_goals')
          .select('*')
          .eq('year', year)
          .in('listing_id', listingIds);

        if (goalsError || !goals) {
          throw new Error(`Failed to fetch goals: ${goalsError?.message}`);
        }

        console.log(`Processing ${goals.length} goals in background`);

        // Process in batches of 500
        const BATCH_SIZE = 500;
        let totalUpdated = 0;
        let errors = 0;

        for (let i = 0; i < goals.length; i += BATCH_SIZE) {
          const batch = goals.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(goals.length / BATCH_SIZE);
          
          console.log(`Processing batch ${batchNum}/${totalBatches}, goals ${i + 1} to ${Math.min(i + BATCH_SIZE, goals.length)}`);

          // Update progress
          await supabase
            .from('sync_jobs')
            .update({
              progress_message: `Processing batch ${batchNum}/${totalBatches}...`,
              items_synced: totalUpdated,
            })
            .eq('id', syncJob.id);

          // Recalculate values for this batch
          const updates = batch.map(goal => {
            const currentProjection = goal.projection_revenue || 0;
            
            return {
              id: goal.id,
              goal_revenue: currentProjection,
              projection_revenue: Math.round(currentProjection * 0.85),
              budget_revenue: Math.round(currentProjection * 0.75),
              updated_at: new Date().toISOString(),
            };
          });

          // Update the batch
          for (const update of updates) {
            const { error: updateError } = await supabase
              .from('property_goals')
              .update({
                goal_revenue: update.goal_revenue,
                projection_revenue: update.projection_revenue,
                budget_revenue: update.budget_revenue,
                updated_at: update.updated_at,
              })
              .eq('id', update.id);

            if (updateError) {
              console.error(`Error updating goal ${update.id}:`, updateError);
              errors++;
            } else {
              totalUpdated++;
            }
          }

          console.log(`Batch complete. Updated ${totalUpdated} goals so far, ${errors} errors`);
        }

        // Mark job as completed
        await supabase
          .from('sync_jobs')
          .update({
            status: 'completed',
            progress_message: `Successfully recalculated ${totalUpdated} goals`,
            items_synced: totalUpdated,
            completed_at: new Date().toISOString(),
          })
          .eq('id', syncJob.id);

        console.log(`Recalculation complete. Total updated: ${totalUpdated}, Errors: ${errors}`);

      } catch (error) {
        console.error('Background task error:', error);
        await supabase
          .from('sync_jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', syncJob.id);
      }
    };

    // Run in background
    EdgeRuntime.waitUntil(backgroundTask());

    // Return immediately
    return new Response(
      JSON.stringify({
        success: true,
        jobId: syncJob.id,
        message: `Started recalculation of ${totalGoals} goals`,
        totalGoals,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in recalculate-goals function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
