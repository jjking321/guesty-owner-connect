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

interface CalendarDay {
  date: string;
  is_available: boolean;
  price: number | null;
  min_nights: number | null;
  status: string | null;
}

interface Gap {
  startDate: string;
  endDate: string;
  length: number;
  minNights: number;
  avgPrice: number;
  isBookable: boolean;
}

interface PricingAnomaly {
  date: string;
  ourPrice: number;
  compAvgPrice: number;
  percentDiff: number;
  type: 'below_market' | 'above_market';
}

serve(async (req) => {
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
    console.log(`${isFollowUp ? 'Follow-up' : 'Initial'} revenue actions for listing:`, listingId);

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
      .eq('prompt_key', 'revenue_actions')
      .single();

    const systemPrompt = promptConfig?.system_prompt || getDefaultSystemPrompt();

    // Build messages array for AI
    let aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt }
    ];

    if (isFollowUp) {
      // For follow-ups, strip the generation instruction and mark as reference only
      const modifiedMessages = messages.map((msg: Message, index: number) => {
        if (index === 0 && msg.role === 'user') {
          const cleanedContent = msg.content.replace(/---\s*\*\*INSTRUCTION:.*$/s, '').trim();
          return {
            role: 'user',
            content: `[REFERENCE DATA - just answer the question in 1-3 sentences]\n\n${cleanedContent}`
          };
        }
        return msg;
      });
      aiMessages = aiMessages.concat(modifiedMessages);
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
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content received from AI');
    }

    console.log('Successfully generated revenue actions');

    const responseData: any = { 
      content,
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
    console.error('Error in generate-revenue-actions:', error);
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
  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Fetch calendar data for next 90 days
  const { data: calendarData } = await supabase
    .from('capacity_calendar')
    .select('date, is_available, price, min_nights, status')
    .eq('listing_id', listingId)
    .gte('date', today)
    .lte('date', ninetyDaysOut)
    .order('date');

  // Fetch comparables with future rates and booking settings
  const { data: comparables } = await supabase
    .from('property_comparables')
    .select('listing_name, booking_settings, future_rates, is_selected')
    .eq('listing_id', listingId)
    .eq('is_selected', true);

  // Fetch compset summary
  const { data: compsetSummary } = await supabase
    .from('property_compset_summary')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle();

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

  // Fetch YTD reservation nights for pacing
  const startOfYear = `${currentYear}-01-01`;
  const { data: currentYearNights } = await supabase
    .from('reservation_nights')
    .select('night_date, revenue_allocation')
    .eq('listing_id', listingId)
    .gte('night_date', startOfYear)
    .lte('night_date', today);

  // Fetch prior year nights for YoY comparison
  const priorYear = currentYear - 1;
  const priorYearStart = `${priorYear}-01-01`;
  const priorYearEquivalentDate = `${priorYear}-${today.slice(5)}`;
  const { data: priorYearNights } = await supabase
    .from('reservation_nights')
    .select('night_date, revenue_allocation')
    .eq('listing_id', listingId)
    .gte('night_date', priorYearStart)
    .lte('night_date', priorYearEquivalentDate);

  // Analyze calendar for gaps and anomalies
  const calendar = calendarData || [];
  const gaps = findGaps(calendar);
  const unbookableGaps = gaps.filter(g => !g.isBookable);
  
  // Calculate our avg min nights
  const ourMinNights = calendar
    .filter((d: CalendarDay) => d.min_nights && d.is_available)
    .map((d: CalendarDay) => d.min_nights!);
  const ourAvgMinNights = ourMinNights.length > 0 
    ? ourMinNights.reduce((a: number, b: number) => a + b, 0) / ourMinNights.length 
    : 0;

  // Calculate comp avg min nights
  const compMinNights: number[] = [];
  (comparables || []).forEach((c: any) => {
    if (c.booking_settings?.min_nights) {
      compMinNights.push(c.booking_settings.min_nights);
    }
  });
  const compAvgMinNights = compMinNights.length > 0
    ? compMinNights.reduce((a: number, b: number) => a + b, 0) / compMinNights.length
    : 0;

  // Find pricing anomalies
  const pricingAnomalies = findPricingAnomalies(calendar, comparables || [], compsetSummary);

  // Calculate YoY pacing
  const currentYtdRevenue = (currentYearNights || []).reduce((sum: number, n: any) => sum + parseFloat(n.revenue_allocation || 0), 0);
  const priorYtdRevenue = (priorYearNights || []).reduce((sum: number, n: any) => sum + parseFloat(n.revenue_allocation || 0), 0);
  const yoyPacing = priorYtdRevenue > 0 ? ((currentYtdRevenue - priorYtdRevenue) / priorYtdRevenue) * 100 : 0;

  // Build context
  return buildDataContext({
    listing,
    calendar,
    gaps,
    unbookableGaps,
    ourAvgMinNights,
    compAvgMinNights,
    comparables: comparables || [],
    compsetSummary,
    pricingAnomalies,
    goals: goals || [],
    forecast,
    currentYtdRevenue,
    priorYtdRevenue,
    yoyPacing,
    currentYear,
    today,
  });
}

function findGaps(calendar: CalendarDay[]): Gap[] {
  const gaps: Gap[] = [];
  let gapStart: CalendarDay | null = null;
  let gapDays: CalendarDay[] = [];

  for (let i = 0; i < calendar.length; i++) {
    const day = calendar[i];
    
    if (day.is_available) {
      if (!gapStart) {
        gapStart = day;
        gapDays = [day];
      } else {
        gapDays.push(day);
      }
    } else {
      if (gapStart && gapDays.length > 0) {
        const minNightsOnFirstDay = gapDays[0].min_nights || 1;
        const avgPrice = gapDays.reduce((sum, d) => sum + (d.price || 0), 0) / gapDays.length;
        
        gaps.push({
          startDate: gapStart.date,
          endDate: gapDays[gapDays.length - 1].date,
          length: gapDays.length,
          minNights: minNightsOnFirstDay,
          avgPrice,
          isBookable: gapDays.length >= minNightsOnFirstDay,
        });
        gapStart = null;
        gapDays = [];
      }
    }
  }

  // Handle trailing gap
  if (gapStart && gapDays.length > 0) {
    const minNightsOnFirstDay = gapDays[0].min_nights || 1;
    const avgPrice = gapDays.reduce((sum, d) => sum + (d.price || 0), 0) / gapDays.length;
    
    gaps.push({
      startDate: gapStart.date,
      endDate: gapDays[gapDays.length - 1].date,
      length: gapDays.length,
      minNights: minNightsOnFirstDay,
      avgPrice,
      isBookable: gapDays.length >= minNightsOnFirstDay,
    });
  }

  return gaps;
}

function findPricingAnomalies(
  calendar: CalendarDay[], 
  comparables: any[], 
  compsetSummary: any
): PricingAnomaly[] {
  const anomalies: PricingAnomaly[] = [];
  
  // Build a map of comp avg prices by date from future_rates
  const compPricesByDate = new Map<string, number[]>();
  
  comparables.forEach(comp => {
    if (comp.future_rates && Array.isArray(comp.future_rates)) {
      comp.future_rates.forEach((rate: any) => {
        if (rate.date && rate.price) {
          const existing = compPricesByDate.get(rate.date) || [];
          existing.push(rate.price);
          compPricesByDate.set(rate.date, existing);
        }
      });
    }
  });

  // Compare our prices to comp averages
  calendar.forEach(day => {
    if (!day.is_available || !day.price) return;
    
    const compPrices = compPricesByDate.get(day.date);
    if (!compPrices || compPrices.length === 0) return;
    
    const compAvg = compPrices.reduce((a, b) => a + b, 0) / compPrices.length;
    const percentDiff = ((day.price - compAvg) / compAvg) * 100;
    
    // Flag if >30% below or >50% above
    if (percentDiff < -30) {
      anomalies.push({
        date: day.date,
        ourPrice: day.price,
        compAvgPrice: compAvg,
        percentDiff,
        type: 'below_market',
      });
    } else if (percentDiff > 50) {
      anomalies.push({
        date: day.date,
        ourPrice: day.price,
        compAvgPrice: compAvg,
        percentDiff,
        type: 'above_market',
      });
    }
  });

  return anomalies;
}

function getDefaultSystemPrompt(): string {
  return `You are an expert revenue manager for vacation rentals. Generate 3-6 actionable items.

MODES:
- INITIAL (first message has property data): Generate the structured action items below
- FOLLOW-UP (user asks a question): Answer in 1-3 sentences MAX. Do NOT regenerate sections.

## REVENUE MANAGEMENT DECISION LOGIC

### PRICING DECISIONS

**When property is significantly BELOW market (>25% under):**
- If dates are NOT booked: Price is NOT the problem. DO NOT suggest lowering further.
  → First check: Is min nights blocking bookings? (most common blocker)
  → Then check: Are comps truly comparable (same tier/quality/size)?
  → Then check: Is this a market-wide demand issue?
  → Suggest: Reduce min nights, marketing push, past guest outreach, OR hold firm
  → If already 30%+ below: Consider RAISING price slightly (race-to-bottom signals desperation)

- If dates are booking well: Good value positioning. Consider modest rate increase to test elasticity.

**When property is significantly ABOVE market (>30% over):**
- If dates are NOT booked: Price MAY be the issue, but verify first
  → Check: Does property have premium features justifying price?
  → Check: How are comps performing at their rates?
  → Suggest: If no justification, test 10-15% reduction on select dates
  
- If dates are booked well: Premium positioning is working. Hold rates.

**When property is AT market rate (±25%):**
- If NOT booked: Focus on min nights, last-minute visibility, marketing - NOT price
- If booked well: Hold or test modest increases on high-demand dates

### GAP FILLING DECISIONS

**Gaps within 7 days:**
- If priced AT or ABOVE market: Consider last-minute discount (10-20%)
- If already BELOW market: DO NOT lower price further. Focus on:
  → Reducing min nights to match gap length
  → Direct outreach to past guests
  → Last-minute deal visibility (Airbnb, VRBO promotions)
- If min nights > gap length: THIS IS THE PROBLEM. Fix min nights first before any price discussion.

**Gaps 8-30 days out:**
- Hold pricing unless significantly above market
- Focus on marketing and visibility
- Only discount if booking velocity is concerning AND price is above market

**Gaps 30+ days out:**
- No urgency. Monitor but don't discount preemptively.

### MIN NIGHTS DECISIONS
- If our min nights >> comp avg (1.5x or more): Too restrictive. Suggest reducing.
- If we have unbookable gaps (min > gap length): CRITICAL issue. Must reduce min nights.
- Exception: Premium properties during peak season may justify higher mins.

### NEVER SUGGEST (FORBIDDEN ACTIONS)
❌ Lowering price if already 25%+ below market - this is a race to the bottom
❌ Lowering price to fill a gap when min nights > gap length - wrong diagnosis
❌ Raising price during obvious low-demand periods without justification
❌ Changes that would make existing gaps unbookable
❌ Generic advice without specific dates or numbers

### ALWAYS INCLUDE
✓ Specific dates for each recommendation
✓ The actual numbers (our price vs comp, our min nights vs comp)
✓ Root cause diagnosis before recommendation
✓ Quantified impact when possible

## PRIORITIES
🔴 Urgent - Unbookable gaps (fix min nights), next 7 days gaps, critical settings issues
⚠️ Settings Issues - Min nights too high, pricing tool misconfiguration
🟡 This Month - Bookable gaps needing attention, pacing concerns
🟢 Strategic - Rate positioning opportunities, longer-term optimizations

## FORMAT
## Revenue Actions - [Property Name]
Generated: [date]

### 🔴 Urgent
1. **[Brief issue]** - [specific dates/numbers]. [Root cause]. [Recommendation].

### ⚠️ Settings Issues (if any)
2. **[Issue type]** - [our data vs comp data]. [Specific fix].

### 🟡 This Month
3. **[Issue]** - [context with numbers]. [Action].

### 🟢 Strategic
4. **[Opportunity]** - [data]. [Suggestion].`;
}

function buildDataContext(data: {
  listing: any;
  calendar: CalendarDay[];
  gaps: Gap[];
  unbookableGaps: Gap[];
  ourAvgMinNights: number;
  compAvgMinNights: number;
  comparables: any[];
  compsetSummary: any;
  pricingAnomalies: PricingAnomaly[];
  goals: any[];
  forecast: any;
  currentYtdRevenue: number;
  priorYtdRevenue: number;
  yoyPacing: number;
  currentYear: number;
  today: string;
}): string {
  const { 
    listing, calendar, gaps, unbookableGaps, ourAvgMinNights, compAvgMinNights,
    comparables, compsetSummary, pricingAnomalies, goals, forecast,
    currentYtdRevenue, priorYtdRevenue, yoyPacing, currentYear, today
  } = data;

  const address = listing.address 
    ? [listing.address.city, listing.address.state].filter(Boolean).join(', ')
    : 'Unknown location';

  let context = `# Revenue Manager Data for Action Items

## Property
- Name: ${listing.nickname || 'Unnamed Property'}
- Location: ${address}
- Bedrooms: ${listing.bedrooms || 'N/A'}
- Today: ${today}

## YoY Pacing
- YTD Revenue (${currentYear}): $${currentYtdRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Same Period Last Year: $${priorYtdRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YoY Change: ${yoyPacing >= 0 ? '+' : ''}${yoyPacing.toFixed(1)}%
`;

  // Goals summary
  if (goals.length > 0) {
    const currentMonth = new Date().getMonth() + 1;
    const totalGoal = goals.reduce((sum, g) => sum + parseFloat(g.goal_revenue || 0), 0);
    const ytdGoal = goals.filter(g => g.month <= currentMonth).reduce((sum, g) => sum + parseFloat(g.goal_revenue || 0), 0);
    
    context += `
## Goals (${currentYear})
- Annual Goal: $${totalGoal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YTD Goal: $${ytdGoal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- YTD Actual: $${currentYtdRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- vs Goal: ${ytdGoal > 0 ? ((currentYtdRevenue / ytdGoal) * 100).toFixed(1) : 'N/A'}%
`;
  }

  // Forecast
  if (forecast) {
    const p50 = (forecast.total_forecast as any)?.p50 || 0;
    context += `
## Revenue Forecast
- On Books: $${parseFloat(forecast.revenue_on_books || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Projected Year-End (P50): $${p50.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Pace Factor: ${forecast.pace_factor ? (forecast.pace_factor * 100).toFixed(1) + '%' : 'N/A'}
`;
  }

  // Calendar gaps - next 90 days
  context += `
## Calendar Gaps (Next 90 Days)
- Total Open Gaps: ${gaps.length}
- Bookable Gaps: ${gaps.filter(g => g.isBookable).length}
`;

  // CRITICAL: Unbookable gaps
  if (unbookableGaps.length > 0) {
    context += `
### ⚠️ UNBOOKABLE GAPS (min nights > gap length - CRITICAL)
`;
    unbookableGaps.forEach(gap => {
      context += `- ${gap.startDate} to ${gap.endDate}: ${gap.length}-night gap with ${gap.minNights}-night minimum (CANNOT BE BOOKED)
`;
    });
  }

  // Upcoming gaps
  const urgentGaps = gaps.filter(g => {
    const gapDate = new Date(g.startDate);
    const daysAway = Math.ceil((gapDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysAway <= 7 && g.isBookable;
  });
  
  if (urgentGaps.length > 0) {
    context += `
### Gaps Within 7 Days (URGENT)
`;
    urgentGaps.forEach(gap => {
      context += `- ${gap.startDate} to ${gap.endDate}: ${gap.length} nights, avg $${gap.avgPrice.toFixed(0)}/night
`;
    });
  }

  // Min nights comparison
  context += `
## Min Nights Analysis
- Our Avg Min Nights: ${ourAvgMinNights.toFixed(1)}
- Comp Avg Min Nights: ${compAvgMinNights.toFixed(1)}
`;
  
  if (ourAvgMinNights > compAvgMinNights * 1.5 && compAvgMinNights > 0) {
    context += `- ⚠️ WARNING: Our min nights is ${(ourAvgMinNights / compAvgMinNights).toFixed(1)}x higher than comps
`;
  }

  // Comp min nights details
  if (comparables.length > 0) {
    context += `
### Comp Min Nights Details
`;
    comparables.forEach((comp, i) => {
      const minNights = comp.booking_settings?.min_nights || 'N/A';
      context += `- ${comp.listing_name || `Comp ${i + 1}`}: ${minNights} nights
`;
    });
  }

  // Pricing anomalies
  if (pricingAnomalies.length > 0) {
    context += `
## Pricing Anomalies (vs Comp Average)
`;
    const belowMarket = pricingAnomalies.filter(a => a.type === 'below_market').slice(0, 5);
    const aboveMarket = pricingAnomalies.filter(a => a.type === 'above_market').slice(0, 5);
    
    if (belowMarket.length > 0) {
      context += `
### Significantly Below Market (>30% under)
`;
      belowMarket.forEach(a => {
        context += `- ${a.date}: $${a.ourPrice} vs comp avg $${a.compAvgPrice.toFixed(0)} (${a.percentDiff.toFixed(0)}%)
`;
      });
    }
    
    if (aboveMarket.length > 0) {
      context += `
### Significantly Above Market (>50% over)
`;
      aboveMarket.forEach(a => {
        context += `- ${a.date}: $${a.ourPrice} vs comp avg $${a.compAvgPrice.toFixed(0)} (+${a.percentDiff.toFixed(0)}%)
`;
      });
    }
  }

  // Compset summary
  if (compsetSummary) {
    context += `
## Market Comparison (TTM)
- Selected Comps: ${compsetSummary.selected_comparables_count || 0}
- Comp Avg TTM Revenue: $${parseFloat(compsetSummary.avg_ttm_revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Comp Avg TTM ADR: $${parseFloat(compsetSummary.avg_ttm_adr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Comp Avg TTM Occupancy: ${compsetSummary.avg_ttm_occupancy ? (compsetSummary.avg_ttm_occupancy * 100).toFixed(1) + '%' : 'N/A'}
`;
  }

  context += `
---
**INSTRUCTION: Please generate 3-6 actionable revenue management items based on the data above. Prioritize unbookable gaps and settings issues first.**
`;

  return context;
}
