import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_SYSTEM_PROMPT = `You are an expert at analyzing vacation rental reviews for Airbnb policy violations.

OBJECTIVE: Analyze whether this review can be disputed and removed based on Airbnb's 5 official dispute categories. Be aggressive in finding reasons for removal - we want to exploit Airbnb's policy in our favor.

## Airbnb's 5 Dispute Categories

1. **Retaliatory** - Review was left in retaliation for enforcing house rules, policies, or requesting payment for damages. Signs include: guest was charged for damages, guest broke rules and was reminded, host enforced check-out time or noise policies.

2. **Irrelevant** - Review doesn't relate to the actual stay, or guest never checked in. Signs include: complaints about things outside host's control, generic complaints not specific to property, review discusses cancellation rather than stay.

3. **Pressure or Coercion** - Guest threatened a bad review to get refund/discount, or was incentivized. Signs include: messages demanding refunds, threats in conversation, quid-pro-quo requests.

4. **Competitor** - Review from someone affiliated with or competing with the listing. Signs include: reviewer owns/manages similar properties, suspicious booking patterns, generic stay with detailed negative review.

5. **Content Policy Violation** - Discriminatory content, private info disclosure, profanity, or harassment. Signs include: personal attacks, racist/sexist language, sharing host's personal information, threats.

## Analysis Guidelines

- Look for ANY evidence that could fit these categories
- Guest complaints about being charged for damages = potential retaliation
- Guest demanding refunds in messages = potential coercion
- Vague or off-topic complaints = potential irrelevance
- Be creative in framing the case - think like a lawyer advocating for removal
- Even weak cases might succeed if framed well

## Conversation Red Flags
- Threats to leave bad review ("I'll leave a 1-star if you don't...")
- Requests for refunds with implied consequences
- Aggressive or harassing language
- Mentions of competitors or alternative listings
- Complaints that happened BEFORE a negative interaction with host

## Scoring Guidelines
- 0-20%: Very unlikely - review appears genuine and policy-compliant
- 21-40%: Possible but weak - some minor violations but hard to prove
- 41-60%: Moderate chance - clear policy concerns that could be argued
- 61-80%: Good chance - strong evidence of violation
- 81-100%: Excellent chance - clear-cut policy violation

## Using Pre-Analyzed Evidence
If pre-analyzed conversation red flags are provided, incorporate them directly into your case:
- Reference the exact quotes identified as evidence
- Use the category classifications (Extortion, Retaliatory, Third-Party, Irrelevant) to strengthen your argument
- High-severity flags should be prominently featured in the case description
- Build your argument around the strongest evidence first
- Cite the specific message quotes when making your case to Airbnb`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reviewId, includeConversation = true } = await req.json();
    
    if (!reviewId) {
      throw new Error('reviewId is required');
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Analyzing dispute for review: ${reviewId}`);

    // Set status to analyzing
    await supabase
      .from('reviews')
      .update({ dispute_status: 'analyzing' })
      .eq('id', reviewId);

    // Fetch review with all related data
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select(`
        *,
        listings:listing_id (
          id,
          nickname,
          address,
          guesty_account_id
        )
      `)
      .eq('id', reviewId)
      .single();

    if (reviewError || !review) {
      throw new Error(`Review not found: ${reviewError?.message}`);
    }

    // Get organization ID from guesty account
    const { data: guestyAccount } = await supabase
      .from('guesty_accounts')
      .select('organization_id')
      .eq('id', review.guesty_account_id)
      .single();

    // Fetch custom prompt if configured
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (guestyAccount?.organization_id) {
      const { data: promptConfig } = await supabase
        .from('ai_prompt_configs')
        .select('system_prompt')
        .eq('organization_id', guestyAccount.organization_id)
        .eq('prompt_key', 'review_dispute_analysis')
        .single();

      if (promptConfig?.system_prompt) {
        systemPrompt = promptConfig.system_prompt;
      }
    }

    // Optionally fetch conversation if not already present
    let messages = review.dispute_message_history || [];
    if (includeConversation && messages.length === 0 && review.reservation_id) {
      console.log('Fetching conversation before analysis...');
      
      try {
        const convResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-dispute-conversation`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reviewId, reservationId: review.reservation_id }),
        });

        if (convResponse.ok) {
          const convData = await convResponse.json();
          messages = convData.messages || [];
        }
      } catch (error) {
        console.error('Failed to fetch conversation:', error);
      }
    }

    // Fetch reservation details if available
    let reservation = null;
    if (review.reservation_id) {
      const { data: resData } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', review.reservation_id)
        .single();
      reservation = resData;
    }

    // Build context for AI
    const listing = review.listings as any;
    const address = listing?.address 
      ? [listing.address.city, listing.address.state].filter(Boolean).join(', ')
      : 'Unknown location';

    let context = `# Review Dispute Analysis Request

## Property Information
- Name: ${listing?.nickname || 'Unknown Property'}
- Location: ${address}

## Review Details
- Rating: ${review.rating}/5
- Date: ${review.review_date}
- Guest: ${review.guest_name || 'Unknown'}
- Platform: ${review.source || 'Unknown'}

## Review Text
"${review.review_text || 'No review text available'}"

## Category Ratings
${review.category_ratings ? JSON.stringify(review.category_ratings, null, 2) : 'Not available'}
`;

    if (reservation) {
      context += `
## Reservation Details
- Check-in: ${reservation.check_in}
- Check-out: ${reservation.check_out}
- Nights: ${reservation.nights_count}
- Status: ${reservation.status}
- Total Paid: $${reservation.total_paid || 'N/A'}
`;
    }

    if (messages.length > 0) {
      context += `
## Guest-Host Conversation History
`;
      messages.forEach((msg: any) => {
        const date = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : 'Unknown date';
        context += `[${date}] ${msg.sender === 'guest' ? 'GUEST' : 'HOST'}: ${msg.content}\n`;
      });
    } else {
      context += `
## Conversation History
No conversation history available.
`;
    }

    // Add pre-analyzed red flags if available
    if (review.dispute_conversation_redflags) {
      const redflags = review.dispute_conversation_redflags as any;
      context += `
## Pre-Analyzed Conversation Red Flags
Evidence Strength: ${redflags.evidenceStrength?.toUpperCase() || 'UNKNOWN'}
Assessment: ${redflags.overallAssessment || 'No assessment available'}

`;
      if (redflags.redflags && redflags.redflags.length > 0) {
        context += `### Identified Violations:\n`;
        redflags.redflags.forEach((flag: any, idx: number) => {
          context += `
**${idx + 1}. ${flag.category} (${flag.severity} severity)**
- Quote: "${flag.quote}"
- Context: ${flag.context}
- From: ${flag.sender === 'guest' ? 'Guest' : 'Host'}
`;
        });
      }
      context += `
IMPORTANT: Use these pre-analyzed red flags as supporting evidence in your dispute case. Reference the specific quotes when building your argument.
`;
    }

    context += `
---
Please analyze this review and determine if it can be disputed for removal.
`;

    console.log('Calling Lovable AI for analysis...');

    // Call Lovable AI with tool calling for structured output
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_dispute_analysis",
              description: "Submit the analysis of whether this review can be disputed and removed",
              parameters: {
                type: "object",
                properties: {
                  likelihoodScore: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                    description: "Probability of successful removal (0-100)"
                  },
                  violationCategory: {
                    type: "string",
                    enum: ["Retaliatory", "Irrelevant", "Pressure", "Competitor", "Policy", "None"],
                    description: "Which of the 5 Airbnb dispute categories applies, or None if no violation"
                  },
                  categoryReason: {
                    type: "string",
                    description: "Brief explanation of why this category applies (1-2 sentences)"
                  },
                  caseDescription: {
                    type: "string",
                    description: "Detailed dispute description to submit to Airbnb (2-4 paragraphs, persuasive, citing specific evidence)"
                  },
                  conversationSummary: {
                    type: "string",
                    description: "Summary of key conversation points relevant to the dispute"
                  },
                  hasThreats: {
                    type: "boolean",
                    description: "Whether the conversation contains threats to leave bad review"
                  },
                  hasPressure: {
                    type: "boolean",
                    description: "Whether there was pressure or coercion in the conversation"
                  },
                  hasRefundDemands: {
                    type: "boolean",
                    description: "Whether guest demanded refunds in the conversation"
                  }
                },
                required: ["likelihoodScore", "violationCategory", "categoryReason", "caseDescription", "conversationSummary", "hasThreats", "hasPressure", "hasRefundDemands"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "submit_dispute_analysis" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Reset status on rate limit
        await supabase
          .from('reviews')
          .update({ dispute_status: 'triage' })
          .eq('id', reviewId);
          
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        await supabase
          .from('reviews')
          .update({ dispute_status: 'triage' })
          .eq('id', reviewId);
          
        return new Response(JSON.stringify({ error: "AI credits exhausted, please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    console.log('AI response received');

    // Parse the tool call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'submit_dispute_analysis') {
      throw new Error('Invalid AI response - no tool call found');
    }

    const analysis = JSON.parse(toolCall.function.arguments);
    console.log('Analysis result:', JSON.stringify(analysis, null, 2));

    // Determine status based on score
    let newStatus: string;
    if (analysis.likelihoodScore === 0) {
      newStatus = 'not_eligible';
    } else {
      newStatus = 'submit_claim';
    }

    const isHighPriority = analysis.likelihoodScore >= 70;

    // Build case file object
    const caseFile = {
      category_reason: analysis.categoryReason,
      description: analysis.caseDescription,
      violation_category: analysis.violationCategory,
      likelihood_score: analysis.likelihoodScore,
      generated_at: new Date().toISOString(),
    };

    // Update review with analysis results
    const { error: updateError } = await supabase
      .from('reviews')
      .update({
        dispute_status: newStatus,
        dispute_likelihood_score: analysis.likelihoodScore,
        dispute_violation_category: analysis.violationCategory,
        dispute_case_file: caseFile,
        dispute_analyzed_at: new Date().toISOString(),
        dispute_is_high_priority: isHighPriority,
        dispute_conversation_summary: analysis.conversationSummary,
        dispute_has_threats: analysis.hasThreats,
        dispute_has_pressure: analysis.hasPressure,
        dispute_has_refund_demands: analysis.hasRefundDemands,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewId);

    if (updateError) {
      throw new Error(`Failed to update review: ${updateError.message}`);
    }

    console.log(`Analysis complete. Score: ${analysis.likelihoodScore}%, Status: ${newStatus}`);

    return new Response(JSON.stringify({
      success: true,
      analysis: {
        ...analysis,
        status: newStatus,
        isHighPriority,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-review-dispute:', error);
    
    // Try to reset status on error
    try {
      const { reviewId } = await req.clone().json();
      if (reviewId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('reviews')
          .update({ dispute_status: 'triage' })
          .eq('id', reviewId);
      }
    } catch (e) {
      console.error('Failed to reset status:', e);
    }
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
