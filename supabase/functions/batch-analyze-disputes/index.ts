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

  try {
    const { limit = 10, skipWithoutReservation = false, maxAgeDays = 7 } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Starting batch dispute analysis. Limit: ${limit}, maxAgeDays: ${maxAgeDays}, skipWithoutReservation: ${skipWithoutReservation}`);

    // Calculate cutoff date for recent reviews only
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    // Fetch reviews in triage status from past maxAgeDays
    let query = supabase
      .from('reviews')
      .select('id, guest_name, reservation_id, listing_id, review_date')
      .eq('dispute_status', 'triage')
      .gte('review_date', cutoffDate.toISOString())
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

    const results: ProcessResult[] = [];
    let processed = 0;
    let skipped = 0;

    for (const review of triageReviews) {
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
            return new Response(JSON.stringify({
              success: false,
              message: 'Guesty authentication rate limited. Please wait a few minutes.',
              processed,
              skipped: skipped + (triageReviews.length - results.length),
              results,
            }), {
              status: 429,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          if (convResponse.status === 429) {
            console.log(`Rate limited on conversation fetch, skipping review`);
            result.error = 'Rate limit on conversation fetch';
            skipped++;
            results.push(result);
            await delay(5000); // Wait longer on rate limit
            continue;
          }
          
          // Handle server errors (Guesty API down)
          if (convResponse.status >= 500) {
            console.log(`Guesty API error on conversation fetch (${convResponse.status}), skipping review`);
            result.error = `Guesty API error: ${convResponse.status}`;
            skipped++;
            results.push(result);
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
              await delay(5000);
              continue;
            }
            if (redflagResponse.status === 402) {
              console.log(`AI credits exhausted, stopping batch`);
              result.error = 'AI credits exhausted';
              results.push(result);
              return new Response(JSON.stringify({
                success: false,
                message: 'AI credits exhausted',
                processed,
                skipped: skipped + 1,
                results,
              }), {
                status: 402,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
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
            await delay(5000);
            continue;
          }
          if (analysisResponse.status === 402) {
            console.log(`AI credits exhausted, stopping batch`);
            result.error = 'AI credits exhausted';
            results.push(result);
            return new Response(JSON.stringify({
              success: false,
              message: 'AI credits exhausted',
              processed,
              skipped: skipped + 1,
              results,
            }), {
              status: 402,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          const errorText = await analysisResponse.text();
          throw new Error(`Dispute analysis failed: ${analysisResponse.status} - ${errorText}`);
        }

        const analysisData = await analysisResponse.json();
        console.log(`Analysis complete: Score ${analysisData.analysis?.likelihoodScore}%, Status: ${analysisData.analysis?.status}`);

        result.status = analysisData.analysis?.status;
        result.score = analysisData.analysis?.likelihoodScore;
        processed++;
        results.push(result);

        // Delay between reviews to respect Guesty rate limits (15/sec, 120/min)
        // Each review makes 2-3 Guesty API calls internally
        await delay(3000);

      } catch (error) {
        console.error(`Error processing review ${review.id}:`, error);
        result.error = error instanceof Error ? error.message : 'Unknown error';
        skipped++;
        results.push(result);
        
        // Reset status back to triage on error
        await supabase
          .from('reviews')
          .update({ dispute_status: 'triage' })
          .eq('id', review.id);
      }
    }

    console.log(`\nBatch processing complete. Processed: ${processed}, Skipped: ${skipped}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${processed} reviews, skipped ${skipped}`,
      processed,
      skipped,
      results,
    }), {
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
