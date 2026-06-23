import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessResult {
  reviewId: string;
  guestName?: string;
  status?: string;
  score?: number;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Auth: service-role (cron / nightly-sync) or admin/super_admin user
  const authBearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const isServiceRole = authBearer.length > 0 && authBearer === supabaseServiceKey;
  if (!isServiceRole) {
    if (!authBearer) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(authBearer);
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: roleRow } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', userData.user.id)
      .in('role', ['admin', 'super_admin'])
      .limit(1)
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  try {
    const { limit = 10, skipWithoutReservation = false } = await req.json().catch(() => ({}));

    console.log(`Starting batch dispute analysis. Limit: ${limit}, skipWithoutReservation: ${skipWithoutReservation}`);

    // Check if any account has dispute analysis enabled
    const { data: accounts, error: accountsError } = await supabase
      .from('guesty_accounts')
      .select('id, dispute_analysis_enabled')
      .eq('automated_sync_enabled', true);

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    const anyEnabled = accounts?.some(a => a.dispute_analysis_enabled === true);
    if (!anyEnabled) {
      console.log('Dispute analysis is disabled for all accounts. Skipping.');
      return new Response(JSON.stringify({
        success: true,
        message: 'Dispute analysis is disabled. Enable it in Settings.',
        processed: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch reviews in triage status - no date filter, process any visible triage review
    let query = supabase
      .from('reviews')
      .select('id, guest_name, reservation_id, listing_id, review_date')
      .eq('dispute_status', 'triage')
      .order('review_date', { ascending: false })
      .limit(limit);

    if (skipWithoutReservation) {
      query = query.not('reservation_id', 'is', null);
    }

    const { data: triageReviews, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch triage reviews: ${fetchError.message}`);
    }

    if (!triageReviews || triageReviews.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No reviews in triage to process',
        processed: 0,
        skipped: 0,
        results: [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${triageReviews.length} reviews to process`);

    // Create progress record
    const { data: progressRecord, error: progressError } = await supabase
      .from('dispute_analysis_progress')
      .insert({
        status: 'running',
        total_reviews: triageReviews.length,
        completed_reviews: 0,
        failed_reviews: 0,
        skipped_reviews: 0,
        current_guest_name: triageReviews[0]?.guest_name || 'Unknown',
      })
      .select('id')
      .single();

    if (progressError) {
      console.error('Failed to create progress record:', progressError);
      throw new Error(`Failed to create progress record: ${progressError.message}`);
    }

    const progressId = progressRecord.id;
    console.log(`Created progress record: ${progressId}`);

    // Return progress_id immediately and process async
    // Using EdgeRuntime.waitUntil to continue processing after response
    const responseData = {
      success: true,
      message: 'Batch analysis started',
      progressId,
      totalReviews: triageReviews.length,
    };

    // Start async processing
    const processReviews = async () => {
      const results: ProcessResult[] = [];
      let processed = 0;
      let skipped = 0;
      let failed = 0;

      for (const review of triageReviews) {
        // Check if cancelled
        const { data: currentProgress } = await supabase
          .from('dispute_analysis_progress')
          .select('status')
          .eq('id', progressId)
          .single();

        if (currentProgress?.status === 'cancelled') {
          console.log('Batch cancelled by user');
          break;
        }

        // Update current guest name
        await supabase
          .from('dispute_analysis_progress')
          .update({
            current_guest_name: review.guest_name || 'Unknown',
          })
          .eq('id', progressId);

        const result: ProcessResult = { 
          reviewId: review.id,
          guestName: review.guest_name || 'Unknown',
        };

        try {
          console.log(`\n--- Processing review ${review.id} (${review.guest_name}) ---`);

          // Skip if no reservation_id (can't fetch conversation)
          if (!review.reservation_id) {
            console.log(`Skipping review ${review.id}: No reservation_id`);
            result.error = 'No reservation_id';
            skipped++;
            results.push(result);
            
            await supabase
              .from('dispute_analysis_progress')
              .update({
                skipped_reviews: skipped,
                completed_reviews: processed,
              })
              .eq('id', progressId);
            continue;
          }

          // Track conversation fetch success
          let conversationFetched = false;
          let messageCount = 0;

          // Step 1: Fetch conversation from Guesty
          console.log(`Step 1: Fetching conversation for reservation ${review.reservation_id}`);
          const convResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-dispute-conversation`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              reviewId: review.id, 
              reservationId: review.reservation_id 
            }),
          });

          if (!convResponse.ok) {
            const errorText = await convResponse.text();
            
            // Check for OAuth rate limit (propagated from fetch-dispute-conversation)
            if (errorText.includes('OAUTH_RATE_LIMIT')) {
              console.log('Guesty OAuth rate limited, stopping batch');
              await supabase
                .from('dispute_analysis_progress')
                .update({
                  status: 'failed',
                  error_message: 'Guesty authentication rate limited. Please wait a few minutes.',
                  completed_at: new Date().toISOString(),
                })
                .eq('id', progressId);
              return;
            }
            
            if (convResponse.status === 429) {
              console.log(`Rate limited on conversation fetch, skipping review`);
              result.error = 'Rate limit on conversation fetch';
              skipped++;
              results.push(result);
              await supabase
                .from('dispute_analysis_progress')
                .update({ skipped_reviews: skipped })
                .eq('id', progressId);
              await delay(5000); // Wait longer on rate limit
              continue;
            }
            
            // Handle server errors (Guesty API down)
            if (convResponse.status >= 500) {
              console.log(`Guesty API error on conversation fetch (${convResponse.status}), skipping review`);
              result.error = `Guesty API error: ${convResponse.status}`;
              skipped++;
              results.push(result);
              await supabase
                .from('dispute_analysis_progress')
                .update({ skipped_reviews: skipped })
                .eq('id', progressId);
              await delay(3000);
              continue;
            }
            
            // For 404 or other client errors, log warning but continue
            console.log(`Conversation fetch warning: ${convResponse.status} - ${errorText}`);
          } else {
            const convData = await convResponse.json();
            messageCount = convData.messages?.length || 0;
            conversationFetched = messageCount > 0;
            console.log(`Fetched ${messageCount} messages`);
            
            if (messageCount === 0) {
              console.log(`Warning: No messages found for review ${review.id}`);
            }
          }

          // Delay before next API call
          await delay(1000);

          // Step 2: Analyze conversation red flags (only if messages were fetched)
          if (conversationFetched) {
            console.log(`Step 2: Analyzing conversation red flags`);
            const redflagResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-conversation-redflags`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ reviewId: review.id }),
            });

            if (!redflagResponse.ok) {
              if (redflagResponse.status === 429) {
                console.log(`Rate limited on red flag analysis, skipping review`);
                result.error = 'Rate limit on red flag analysis';
                skipped++;
                results.push(result);
                await supabase
                  .from('dispute_analysis_progress')
                  .update({ skipped_reviews: skipped })
                  .eq('id', progressId);
                await delay(5000);
                continue;
              }
              if (redflagResponse.status === 402) {
                console.log(`AI credits exhausted, stopping batch`);
                result.error = 'AI credits exhausted';
                results.push(result);
                await supabase
                  .from('dispute_analysis_progress')
                  .update({
                    status: 'failed',
                    error_message: 'AI credits exhausted',
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', progressId);
                return;
              }
              const errorText = await redflagResponse.text();
              console.log(`Red flag analysis failed: ${redflagResponse.status} - ${errorText}`);
              // Continue to final analysis anyway
            } else {
              const redflagData = await redflagResponse.json();
              console.log(`Red flag analysis complete: ${redflagData.evidenceStrength || 'unknown'} evidence`);
            }

            // Delay before next API call
            await delay(1000);
          } else {
            console.log(`Skipping red flag analysis: no conversation history`);
          }

          // Step 3: Run final dispute analysis
          console.log(`Step 3: Running final dispute analysis`);
          const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-review-dispute`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              reviewId: review.id,
              includeConversation: false, // Already fetched above
            }),
          });

          if (!analysisResponse.ok) {
            if (analysisResponse.status === 429) {
              console.log(`Rate limited on dispute analysis, skipping review`);
              result.error = 'Rate limit on dispute analysis';
              skipped++;
              results.push(result);
              await supabase
                .from('dispute_analysis_progress')
                .update({ skipped_reviews: skipped })
                .eq('id', progressId);
              await delay(5000);
              continue;
            }
            if (analysisResponse.status === 402) {
              console.log(`AI credits exhausted, stopping batch`);
              result.error = 'AI credits exhausted';
              results.push(result);
              await supabase
                .from('dispute_analysis_progress')
                .update({
                  status: 'failed',
                  error_message: 'AI credits exhausted',
                  completed_at: new Date().toISOString(),
                })
                .eq('id', progressId);
              return;
            }
            const errorText = await analysisResponse.text();
            console.error(`Dispute analysis failed: ${analysisResponse.status} - ${errorText}`);
            failed++;
            result.error = `Analysis failed: ${analysisResponse.status}`;
            results.push(result);
            
            await supabase
              .from('dispute_analysis_progress')
              .update({ failed_reviews: failed })
              .eq('id', progressId);
            
            // Reset status back to triage on error
            await supabase
              .from('reviews')
              .update({ dispute_status: 'triage' })
              .eq('id', review.id);
            
            await delay(3000);
            continue;
          }

          const analysisData = await analysisResponse.json();
          console.log(`Analysis complete: Score ${analysisData.analysis?.likelihoodScore}%, Status: ${analysisData.analysis?.status}`);

          result.status = analysisData.analysis?.status;
          result.score = analysisData.analysis?.likelihoodScore;
          processed++;
          results.push(result);

          // Update progress
          await supabase
            .from('dispute_analysis_progress')
            .update({
              completed_reviews: processed,
              failed_reviews: failed,
              skipped_reviews: skipped,
            })
            .eq('id', progressId);

          // Delay between reviews to respect Guesty rate limits (15/sec, 120/min)
          await delay(3000);

        } catch (error) {
          console.error(`Error processing review ${review.id}:`, error);
          result.error = error instanceof Error ? error.message : 'Unknown error';
          failed++;
          results.push(result);
          
          await supabase
            .from('dispute_analysis_progress')
            .update({ failed_reviews: failed })
            .eq('id', progressId);
          
          // Reset status back to triage on error
          await supabase
            .from('reviews')
            .update({ dispute_status: 'triage' })
            .eq('id', review.id);
        }
      }

      console.log(`\nBatch processing complete. Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}`);

      // Mark as completed
      await supabase
        .from('dispute_analysis_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_reviews: processed,
          failed_reviews: failed,
          skipped_reviews: skipped,
          current_guest_name: null,
        })
        .eq('id', progressId);
    };

    // Start processing in background using EdgeRuntime.waitUntil if available
    // Otherwise fall back to not awaiting
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processReviews());
    } else {
      // Fallback: start processing but don't await
      processReviews().catch(err => {
        console.error('Background processing error:', err);
        supabase
          .from('dispute_analysis_progress')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', progressId);
      });
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in batch-analyze-disputes:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<unknown>) => void;
} | undefined;
