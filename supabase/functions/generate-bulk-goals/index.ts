import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerationResult {
  listingId: string;
  nickname: string;
  success: boolean;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { year, excludeLocked = true } = await req.json();
    console.log('Generating bulk goals for year:', year, 'excludeLocked:', excludeLocked);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's organization
    const { data: orgMember, error: orgError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (orgError || !orgMember) {
      throw new Error('No organization found for user');
    }

    const organizationId = orgMember.organization_id;

    // Fetch all active listings for the organization
    const { data: guestyAccounts, error: accountsError } = await supabase
      .from('guesty_accounts')
      .select('id')
      .eq('organization_id', organizationId);

    if (accountsError) throw accountsError;

    const accountIds = guestyAccounts?.map(a => a.id) || [];
    
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname, active')
      .in('guesty_account_id', accountIds)
      .eq('active', true);

    if (listingsError) throw listingsError;

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          results: [], 
          summary: { total: 0, succeeded: 0, skipped: 0, failed: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If excludeLocked is true, filter out listings with locked goals
    let eligibleListings = listings;
    
    if (excludeLocked) {
      const { data: lockedGoals, error: lockedError } = await supabase
        .from('property_goals')
        .select('listing_id')
        .eq('year', year)
        .eq('locked', true);

      if (lockedError) {
        console.error('Error fetching locked goals:', lockedError);
      } else if (lockedGoals && lockedGoals.length > 0) {
        const lockedListingIds = new Set(lockedGoals.map(g => g.listing_id));
        eligibleListings = listings.filter(l => !lockedListingIds.has(l.id));
      }
    }

    console.log(`Processing ${eligibleListings.length} properties (${listings.length - eligibleListings.length} skipped due to locked goals)`);

    // Generate goals for each listing
    const results: GenerationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const listing of eligibleListings) {
      try {
        console.log(`Generating goals for ${listing.nickname} (${listing.id})`);
        
        const { data, error } = await supabase.functions.invoke('suggest-property-goals', {
          body: { listingId: listing.id, year }
        });

        if (error) {
          throw error;
        }

        if (data && data.goals) {
          // Save the goals
          const upserts = data.goals.map((g: any) => ({
            listing_id: listing.id,
            year,
            month: g.month,
            budget_revenue: g.budget,
            projection_revenue: g.projection,
            goal_revenue: g.goal,
            locked: false, // New goals are unlocked by default
          }));

          const { error: saveError } = await supabase
            .from('property_goals')
            .upsert(upserts, { onConflict: 'listing_id,year,month' });

          if (saveError) throw saveError;

          results.push({
            listingId: listing.id,
            nickname: listing.nickname || 'Unknown',
            success: true,
          });
          succeeded++;
        } else {
          throw new Error('No goals returned from AI');
        }
      } catch (error: any) {
        console.error(`Failed to generate goals for ${listing.nickname}:`, error);
        results.push({
          listingId: listing.id,
          nickname: listing.nickname || 'Unknown',
          success: false,
          error: error.message,
        });
        failed++;
      }
    }

    const summary = {
      total: listings.length,
      succeeded,
      skipped: listings.length - eligibleListings.length,
      failed,
    };

    console.log('Bulk generation complete:', summary);

    return new Response(
      JSON.stringify({ success: true, results, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in generate-bulk-goals:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
