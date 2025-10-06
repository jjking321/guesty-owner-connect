/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
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
    const { year, excludeLocked = true, onlyMissingGoals = false } = await req.json();
    console.log('Generating bulk goals for year:', year, 'excludeLocked:', excludeLocked, 'onlyMissingGoals:', onlyMissingGoals);

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

    // Filter listings based on requirements
    let eligibleListings = listings;
    
    if (onlyMissingGoals) {
      // Only include properties without any goals for this year
      const { data: existingGoals, error: goalsError } = await supabase
        .from('property_goals')
        .select('listing_id')
        .eq('year', year);

      if (goalsError) {
        console.error('Error fetching existing goals:', goalsError);
      } else if (existingGoals && existingGoals.length > 0) {
        const listingsWithGoals = new Set(existingGoals.map(g => g.listing_id));
        eligibleListings = listings.filter(l => !listingsWithGoals.has(l.id));
      }
    } else if (excludeLocked) {
      // Filter out listings with locked goals
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

    const skipReason = onlyMissingGoals ? 'already have goals' : 'locked goals';
    console.log(`Processing ${eligibleListings.length} properties (${listings.length - eligibleListings.length} skipped due to ${skipReason})`);

    // Process in background - batch of 3 properties at a time to avoid overwhelming the system
    const processInBackground = async () => {
      const results: GenerationResult[] = [];
      let succeeded = 0;
      let failed = 0;
      const batchSize = 3;

      try {
        let processed = 0;
        for (const listing of eligibleListings) {
          try {
            console.log(`Generating goals for ${listing.nickname} (${listing.id})`);

            const { data, error } = await supabase.functions.invoke('suggest-property-goals', {
              body: { listingId: listing.id, year }
            });

            if (error) {
              console.error(`Error from suggest-property-goals for ${listing.nickname}:`, error);
              throw error;
            }

            if (data && data.goals) {
              const rows = data.goals.map((g: any) => ({
                listing_id: listing.id,
                year,
                month: g.month,
                budget_revenue: g.budget,
                projection_revenue: g.projection,
                goal_revenue: g.goal,
                locked: false,
              }));

              // Insert immediately for missing-only; otherwise upsert
              if (onlyMissingGoals) {
                const { error: insertError } = await supabase
                  .from('property_goals')
                  .insert(rows);
                if (insertError) {
                  console.error(`Error inserting goals for ${listing.nickname}:`, insertError);
                  throw insertError;
                }
              } else {
                const { error: upsertError } = await supabase
                  .from('property_goals')
                  .upsert(rows, { onConflict: 'listing_id,year,month' });
                if (upsertError) {
                  console.error(`Error upserting goals for ${listing.nickname}:`, upsertError);
                  throw upsertError;
                }
              }

              processed++;
              succeeded++;
              console.log(`Saved goals for ${listing.nickname} (${processed}/${eligibleListings.length})`);
            } else {
              console.error(`No goals returned for ${listing.nickname}:`, data);
              throw new Error('No goals returned from AI');
            }
          } catch (error: any) {
            console.error(`Failed to generate goals for ${listing.nickname}:`, error?.message || error);
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
      } catch (error: any) {
        console.error('Fatal error in background processing:', error.message || error);
      }
    };

    // Start background processing without blocking response (keeps running after response)
    // Use EdgeRuntime.waitUntil to ensure the runtime keeps the task alive
    try {
      EdgeRuntime.waitUntil(processInBackground());
    } catch {
      // Fallback: fire-and-forget
      processInBackground().catch(err => {
        console.error('Background processing failed:', err);
      });
    }

    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Started generating goals for ${eligibleListings.length} properties. This will continue in the background.`,
        totalProperties: eligibleListings.length
      }),
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
