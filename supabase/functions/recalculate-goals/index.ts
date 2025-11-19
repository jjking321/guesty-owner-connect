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

    // Fetch all property_goals for the specified year that the user has access to
    // We'll use the service role key but filter by user's organization
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
          success: true, 
          message: 'No guesty accounts found for user',
          totalProcessed: 0,
          totalUpdated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
          success: true, 
          message: 'No listings found for user',
          totalProcessed: 0,
          totalUpdated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all property_goals for the year and user's listings
    const { data: goals, error: goalsError } = await supabase
      .from('property_goals')
      .select('*')
      .eq('year', year)
      .in('listing_id', listingIds);

    if (goalsError) {
      throw new Error(`Failed to fetch goals: ${goalsError.message}`);
    }

    if (!goals || goals.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `No goals found for year ${year}`,
          totalProcessed: 0,
          totalUpdated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${goals.length} goals to recalculate`);

    // Process in batches of 500
    const BATCH_SIZE = 500;
    let totalUpdated = 0;
    let errors = 0;

    for (let i = 0; i < goals.length; i += BATCH_SIZE) {
      const batch = goals.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}, goals ${i + 1} to ${Math.min(i + BATCH_SIZE, goals.length)}`);

      // Recalculate values for this batch
      const updates = batch.map(goal => {
        const currentProjection = goal.projection_revenue || 0;
        
        return {
          id: goal.id,
          goal_revenue: currentProjection, // Move projection to goal
          projection_revenue: Math.round(currentProjection * 0.85), // 85% of current projection
          budget_revenue: Math.round(currentProjection * 0.75), // 75% of current projection
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

    console.log(`Recalculation complete. Total updated: ${totalUpdated}, Errors: ${errors}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully recalculated ${totalUpdated} goals for year ${year}`,
        totalProcessed: goals.length,
        totalUpdated,
        errors,
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
