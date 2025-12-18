import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId, messages } = await req.json();
    
    if (!listingId) {
      throw new Error('listingId is required');
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const isFollowUp = messages && messages.length > 0;
    console.log(`${isFollowUp ? 'Follow-up' : 'Initial'} call prep for listing:`, listingId);

    // Fetch listing details
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('*, guesty_account_id')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      throw new Error(`Listing not found: ${listingError?.message}`);
    }

    console.log('Found listing:', listing.nickname);

    // Get organization ID from guesty account
    const { data: guestyAccount } = await supabase
      .from('guesty_accounts')
      .select('organization_id')
      .eq('id', listing.guesty_account_id)
      .single();

    if (!guestyAccount) {
      throw new Error('Could not find organization for this listing');
    }

    // Fetch configurable system prompt
    const { data: promptConfig } = await supabase
      .from('ai_prompt_configs')
      .select('system_prompt')
      .eq('organization_id', guestyAccount.organization_id)
      .eq('prompt_key', 'call_prep')
      .single();

    const systemPrompt = promptConfig?.system_prompt || getDefaultSystemPrompt();

    // Build messages array for AI
    let aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt }
    ];

    if (isFollowUp) {
      // For follow-ups, use the existing conversation history
      // The first message in history should contain the data context
      aiMessages = aiMessages.concat(messages);
    } else {
      // For initial generation, fetch all property data and build context
      const dataContext = await buildInitialContext(supabase, listing, listingId);
      aiMessages.push({ role: "user", content: dataContext });
    }

    console.log('Calling Lovable AI...');

    // Call Lovable AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
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
    const callPrepContent = aiResponse.choices?.[0]?.message?.content;

    if (!callPrepContent) {
      throw new Error('No content received from AI');
    }

    console.log('Successfully generated call prep');

    // For initial generation, also return the data context so client can use it for follow-ups
    const responseData: any = { 
      content: callPrepContent,
      generatedAt: new Date().toISOString(),
    };

    if (!isFollowUp) {
      const dataContext = await buildInitialContext(supabase, listing, listingId);
      responseData.dataContext = dataContext;
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-call-prep:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function buildInitialContext(supabase: any, listing: any, listingId: string): Promise<string> {
  const currentYear = new Date().getFullYear();

  // Fetch owner info if available
  let owner = null;
  if (listing.owner_id) {
    const { data: ownerData } = await supabase
      .from('owners')
      .select('*')
      .eq('id', listing.owner_id)
      .single();
    owner = ownerData;
  }

  // Fetch current year goals
  const { data: goals } = await supabase
    .from('property_goals')
    .select('*')
    .eq('listing_id', listingId)
    .eq('year', currentYear)
    .order('month');

  // Fetch revenue forecast
  const { data: forecast } = await supabase
    .from('revenue_forecasts')
    .select('*')
    .eq('listing_id', listingId)
    .eq('year', currentYear)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch YTD reservations
  const startOfYear = `${currentYear}-01-01`;
  const today = new Date().toISOString().split('T')[0];
  const { data: reservations } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .in('status', ['confirmed', 'checked_in', 'checked_out'])
    .gte('check_in', startOfYear)
    .lte('check_in', today)
    .order('check_in', { ascending: false });

  // Fetch recent reviews (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const { data: reviews } = await supabase
    .from('reviews')
    .select('*')
    .eq('listing_id', listingId)
    .eq('is_removed', false)
    .gte('review_date', sixMonthsAgo.toISOString())
    .order('review_date', { ascending: false })
    .limit(10);

  // Fetch compset summary
  const { data: compsetSummary } = await supabase
    .from('property_compset_summary')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle();

  // Calculate YTD metrics from reservations
  const ytdMetrics = calculateYTDMetrics(reservations || [], currentYear);

  // Build the data context for the AI
  return buildDataContext({
    listing,
    owner,
    goals: goals || [],
    forecast,
    ytdMetrics,
    reviews: reviews || [],
    compsetSummary,
    currentYear,
  });
}

function getDefaultSystemPrompt(): string {
  return `You are an expert owner relations consultant for a vacation rental management company. Your job is to prepare talking points for a call with a property owner. Your approach should be positive and celebratory, focusing on wins and opportunities.

IMPORTANT GUIDANCE:
- Lead every conversation with positivity and celebration of wins
- Be aware of improvement opportunities internally, but do NOT proactively bring them up unless the owner asks
- Frame challenges as "opportunities" only if directly relevant to a positive recommendation
- The goal is to build owner confidence and highlight the good work being done

Analyze the provided data and generate a concise call prep document with the following sections:

## Performance Summary
A 2-3 sentence positive overview focusing on what's going well.

## Key Wins 🎉
- Bullet points celebrating positive performance metrics, recent wins, and good trends (4-6 items)
- Be specific with numbers and comparisons

## Awareness Notes (Internal - Do Not Proactively Discuss)
- Brief notes on any metrics that could be improved, for YOUR awareness only
- Only discuss these if the owner specifically asks about challenges or concerns
- Keep this section brief (1-3 items max, or "Nothing significant" if performing well)

## Goals & Pacing
How the property is tracking against its goals. Lead with positive momentum where possible.

## Market Position
How this property compares favorably to similar properties. Highlight competitive advantages.

## Suggested Talking Points
- Topics that celebrate success with the owner
- Forward-looking opportunities and exciting possibilities
- Questions to understand owner's goals and satisfaction
- Avoid leading with problems - only address if owner brings them up

## Recent Reviews
Highlight positive guest feedback. Only mention concerning reviews if the owner asks.

Keep responses positive, celebratory, and action-oriented. Use specific numbers from the data provided. Do not make up data - only use what is provided.`;
}

function calculateYTDMetrics(reservations: any[], currentYear: number) {
  if (!reservations || reservations.length === 0) {
    return { totalRevenue: 0, totalNights: 0, reservationCount: 0, averageADR: 0 };
  }

  let totalRevenue = 0;
  let totalNights = 0;
  
  reservations.forEach(r => {
    if (r.source === 'owner') return; // Exclude owner stays
    
    const revenue = parseFloat(r.fare_accommodation_adjusted || 0);
    const nights = r.nights_count || 0;
    
    totalRevenue += revenue;
    totalNights += nights;
  });

  const paidReservations = reservations.filter(r => r.source !== 'owner');

  return {
    totalRevenue,
    totalNights,
    reservationCount: paidReservations.length,
    averageADR: totalNights > 0 ? totalRevenue / totalNights : 0,
  };
}

function buildDataContext(data: {
  listing: any;
  owner: any;
  goals: any[];
  forecast: any;
  ytdMetrics: any;
  reviews: any[];
  compsetSummary: any;
  currentYear: number;
}): string {
  const { listing, owner, goals, forecast, ytdMetrics, reviews, compsetSummary, currentYear } = data;
  
  const address = listing.address 
    ? [listing.address.city, listing.address.state].filter(Boolean).join(', ')
    : 'Unknown location';

  let context = `# Property Data for Call Prep

## Property Information
- Name: ${listing.nickname || 'Unnamed Property'}
- Location: ${address}
- Type: ${listing.property_type || 'N/A'}
- Bedrooms: ${listing.bedrooms || 'N/A'}
- Accommodates: ${listing.accommodates || 'N/A'}
`;

  if (owner) {
    context += `
## Owner Information
- Name: ${owner.full_name || [owner.first_name, owner.last_name].filter(Boolean).join(' ') || 'Unknown'}
- Email: ${owner.email || 'N/A'}
`;
  }

  context += `
## Year-to-Date Performance (${currentYear})
- Total Revenue: $${ytdMetrics.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Total Nights Booked: ${ytdMetrics.totalNights}
- Number of Reservations: ${ytdMetrics.reservationCount}
- Average Daily Rate: $${ytdMetrics.averageADR.toLocaleString(undefined, { maximumFractionDigits: 0 })}
`;

  if (goals && goals.length > 0) {
    const totalGoal = goals.reduce((sum, g) => sum + parseFloat(g.goal_revenue || 0), 0);
    const totalBudget = goals.reduce((sum, g) => sum + parseFloat(g.budget_revenue || 0), 0);
    const totalProjection = goals.reduce((sum, g) => sum + parseFloat(g.projection_revenue || 0), 0);
    
    const currentMonth = new Date().getMonth() + 1;
    const ytdGoal = goals.filter(g => g.month <= currentMonth).reduce((sum, g) => sum + parseFloat(g.goal_revenue || 0), 0);
    
    context += `
## Goals (${currentYear})
- Annual Goal: $${totalGoal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Annual Budget: $${totalBudget.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Annual Projection: $${totalProjection.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YTD Goal (through current month): $${ytdGoal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YTD Actual: $${ytdMetrics.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YTD vs Goal: ${ytdGoal > 0 ? ((ytdMetrics.totalRevenue / ytdGoal) * 100).toFixed(1) : 'N/A'}%
`;
  }

  if (forecast) {
    const p50 = (forecast.total_forecast as any)?.p50 || 0;
    context += `
## Revenue Forecast
- Revenue on Books: $${parseFloat(forecast.revenue_on_books || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Projected Year-End (P50): $${p50.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Pace Factor: ${forecast.pace_factor ? (forecast.pace_factor * 100).toFixed(1) + '%' : 'N/A'}
`;
  }

  if (compsetSummary) {
    context += `
## Market Comparison (vs Comparable Properties)
- Selected Comparables: ${compsetSummary.selected_comparables_count || 0}
- Compset Avg TTM Revenue: $${parseFloat(compsetSummary.avg_ttm_revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Compset Avg TTM ADR: $${parseFloat(compsetSummary.avg_ttm_adr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Compset Avg TTM Occupancy: ${compsetSummary.avg_ttm_occupancy ? (compsetSummary.avg_ttm_occupancy * 100).toFixed(1) + '%' : 'N/A'}
`;
  }

  if (reviews && reviews.length > 0) {
    const avgRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
    const lowRatings = reviews.filter(r => r.rating && r.rating < 4);
    const highRatings = reviews.filter(r => r.rating && r.rating >= 5);
    
    context += `
## Recent Reviews (Last 6 Months)
- Total Reviews: ${reviews.length}
- Average Rating: ${avgRating.toFixed(1)}/5
- 5-Star Reviews: ${highRatings.length}
- Reviews Below 4 Stars: ${lowRatings.length}

Recent Review Highlights:
`;
    
    reviews.slice(0, 5).forEach((review, i) => {
      context += `${i + 1}. ${review.rating || 'N/A'}/5 - "${(review.review_text || '').slice(0, 150)}${(review.review_text || '').length > 150 ? '...' : ''}"
`;
    });
  } else {
    context += `
## Recent Reviews
No reviews in the last 6 months.
`;
  }

  return context;
}
