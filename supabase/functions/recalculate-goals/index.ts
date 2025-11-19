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

    const { year = 2025, offset = 0, limit = 1000, syncJobId = null } = await req.json();

    console.log(`Starting goal recalculation for year ${year} by user ${user.id}, offset: ${offset}, limit: ${limit}`);

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
    // Reuse existing sync job or create new one
    let syncJob;
    if (syncJobId) {
      const { data: existingJob, error: fetchError } = await supabase
        .from('sync_jobs')
        .select()
        .eq('id', syncJobId)
        .single();
      
      if (fetchError || !existingJob) {
        throw new Error(`Failed to fetch sync job: ${fetchError?.message}`);
      }
      syncJob = existingJob;
      console.log(`Continuing sync job ${syncJob.id}, processing offset ${offset}`);
    } else {
      const { data: newJob, error: syncJobError } = await supabase
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

      if (syncJobError || !newJob) {
        throw new Error(`Failed to create sync job: ${syncJobError?.message}`);
      }
      syncJob = newJob;
      console.log(`Created sync job ${syncJob.id} for ${totalGoals} goals`);
    }

    // Start background task
    const backgroundTask = async () => {
      try {
        // Fetch paginated batch of property_goals for the year and user's listings
        const { data: goals, error: goalsError } = await supabase
          .from('property_goals')
          .select('*')
          .eq('year', year)
          .in('listing_id', listingIds)
          .order('listing_id', { ascending: true })
          .range(offset, offset + limit - 1);

        if (goalsError || !goals) {
          throw new Error(`Failed to fetch goals: ${goalsError?.message}`);
        }

        console.log(`Processing batch: ${goals.length} goals (offset ${offset} of ${totalGoals} total)`);

        // Process all fetched goals
        let totalUpdated = 0;
        let errors = 0;

        // Recalculate values for all goals in this batch
        for (const goal of goals) {
          const currentProjection = goal.projection_revenue || 0;
          
          const { error: updateError } = await supabase
            .from('property_goals')
            .update({
              goal_revenue: currentProjection,
              projection_revenue: Math.round(currentProjection * 0.85),
              budget_revenue: Math.round(currentProjection * 0.75),
              updated_at: new Date().toISOString(),
            })
            .eq('id', goal.id);

          if (updateError) {
            console.error(`Error updating goal ${goal.id}:`, updateError);
            errors++;
          } else {
            totalUpdated++;
          }
        }

        // Update progress
        const currentItemsSynced = (syncJob.items_synced || 0) + totalUpdated;
        await supabase
          .from('sync_jobs')
          .update({
            items_synced: currentItemsSynced,
            progress_message: `Processed ${currentItemsSynced} of ${totalGoals} goals...`,
          })
          .eq('id', syncJob.id);

        console.log(`Batch complete. Updated ${totalUpdated} goals, ${currentItemsSynced}/${totalGoals} total`);

        // Check if there are more goals to process
        const nextOffset = offset + limit;
        if (nextOffset < totalGoals) {
          console.log(`Invoking next batch at offset ${nextOffset}`);
          
          // Self-invoke for next batch
          const { error: invokeError } = await supabase.functions.invoke('recalculate-goals', {
            body: {
              year,
              offset: nextOffset,
              limit,
              syncJobId: syncJob.id,
            },
          });

          if (invokeError) {
            throw new Error(`Failed to invoke next batch: ${invokeError.message}`);
          }
          
          console.log(`Next batch triggered successfully`);
        } else {
          // This is the final batch - mark job as completed
          await supabase
            .from('sync_jobs')
            .update({
              status: 'completed',
              progress_message: `Successfully recalculated ${currentItemsSynced} goals`,
              items_synced: currentItemsSynced,
              completed_at: new Date().toISOString(),
            })
            .eq('id', syncJob.id);

          console.log(`Recalculation complete. Total updated: ${currentItemsSynced}, Errors: ${errors}`);
        }

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
