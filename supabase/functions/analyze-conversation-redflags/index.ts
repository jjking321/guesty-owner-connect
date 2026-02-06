import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const systemPrompt = `Role: You are a Senior Policy Compliance Auditor specializing in Airbnb's Terms of Service. Your goal is to conduct a forensic analysis of guest communications to identify any specific violations of Airbnb's Content Policy that warrant a review removal.

Task: Analyze the message_history and review_text to identify evidentiary support for removal. You are looking for high-confidence matches in the following categories:

1. Policy-Violating Financial Inducement (Extortion): Identify any instance where a guest mentions a financial outcome (refunds, discounts, extra services) in connection with their feedback or review status. Document these as potential violations of the Extortion Policy.

2. Conflict of Interest (Retaliatory): Identify if the review was submitted following the host's enforcement of House Rules (e.g., smoking, unauthorized guests, noise) or the filing of a reimbursement claim. Document the timeline to establish a retaliatory pattern.

3. Inauthentic/Irrelevant (Third-Party): Identify if the guest indicates they were not the primary person experiencing the stay (e.g., booking for others). Flag references to issues outside the host's control (e.g., local infrastructure, weather).

4. Evidence Extraction: Extract and quote the exact snippets from the message history that provide the strongest evidence for these violations. These quotes will be used to provide factual documentation to Airbnb Support agents.

Be thorough but only flag genuine policy violations with supporting evidence. If there are no clear violations, report that honestly.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reviewId } = await req.json();
    
    if (!reviewId) {
      return new Response(
        JSON.stringify({ error: "reviewId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the review with conversation history
    const { data: review, error: fetchError } = await supabase
      .from("reviews")
      .select("id, review_text, dispute_message_history, guest_name, review_date")
      .eq("id", reviewId)
      .single();

    if (fetchError || !review) {
      return new Response(
        JSON.stringify({ error: "Review not found", details: fetchError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messages = review.dispute_message_history || [];
    
    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No conversation history available",
          message: "Please fetch the conversation history first before analyzing for red flags."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format conversation for analysis
    const formattedConversation = messages.map((msg: any) => 
      `[${msg.sender?.toUpperCase() || 'UNKNOWN'}${msg.timestamp ? ` - ${new Date(msg.timestamp).toLocaleString()}` : ''}]: ${msg.content || ''}`
    ).join("\n\n");

    const userPrompt = `Please analyze the following conversation and review for potential policy violations:

REVIEW TEXT:
"${review.review_text || 'No review text available'}"

GUEST: ${review.guest_name || 'Unknown'}
REVIEW DATE: ${review.review_date ? new Date(review.review_date).toLocaleDateString() : 'Unknown'}

CONVERSATION HISTORY:
${formattedConversation}

Analyze this conversation for any red flags that could support a dispute claim.`;

    // Call Lovable AI with tool calling for structured output
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_conversation_analysis",
              description: "Submit the analysis of conversation red flags",
              parameters: {
                type: "object",
                properties: {
                  redflags: {
                    type: "array",
                    description: "Array of identified red flags with supporting evidence",
                    items: {
                      type: "object",
                      properties: {
                        category: {
                          type: "string",
                          enum: ["Extortion", "Retaliatory", "Third-Party", "Irrelevant"],
                          description: "The category of policy violation"
                        },
                        severity: {
                          type: "string",
                          enum: ["high", "medium", "low"],
                          description: "How strong the evidence is for this violation"
                        },
                        quote: {
                          type: "string",
                          description: "Exact quote from the conversation that serves as evidence"
                        },
                        context: {
                          type: "string",
                          description: "Brief explanation of why this is a red flag and how it violates policy"
                        },
                        sender: {
                          type: "string",
                          enum: ["guest", "host"],
                          description: "Who sent the flagged message"
                        },
                        timestamp: {
                          type: "string",
                          description: "When the message was sent (if available)"
                        }
                      },
                      required: ["category", "severity", "quote", "context", "sender"]
                    }
                  },
                  overallAssessment: {
                    type: "string",
                    description: "1-2 sentence summary of the conversation red flags and dispute potential"
                  },
                  evidenceStrength: {
                    type: "string",
                    enum: ["strong", "moderate", "weak", "none"],
                    description: "Overall strength of evidence for policy violations"
                  }
                },
                required: ["redflags", "overallAssessment", "evidenceStrength"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "submit_conversation_analysis" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    
    // Extract the tool call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "submit_conversation_analysis") {
      console.error("Unexpected AI response format:", JSON.stringify(aiResponse));
      throw new Error("Failed to get structured analysis from AI");
    }

    let analysis;
    try {
      analysis = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      console.error("Failed to parse tool arguments:", toolCall.function.arguments);
      throw new Error("Failed to parse AI response");
    }

    // Store results in database
    const { error: updateError } = await supabase
      .from("reviews")
      .update({
        dispute_conversation_redflags: analysis,
        dispute_conversation_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewId);

    if (updateError) {
      console.error("Failed to update review:", updateError);
      throw new Error(`Failed to save analysis: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        analysis,
        message: `Found ${analysis.redflags?.length || 0} red flags with ${analysis.evidenceStrength} evidence strength`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("analyze-conversation-redflags error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
