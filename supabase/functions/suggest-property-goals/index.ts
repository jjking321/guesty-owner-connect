import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId, year } = await req.json();
    console.log('Generating goals for listing:', listingId, 'year:', year);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch property details
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .single();

    if (listingError) throw listingError;

    // Fetch all historical reservations for this property
    const { data: reservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('*')
      .eq('listing_id', listingId)
      .eq('status', 'confirmed')
      .order('check_in');

    if (reservationsError) throw reservationsError;

    // Fetch existing goals
    const { data: existingGoals, error: goalsError } = await supabase
      .from('property_goals')
      .select('*')
      .eq('listing_id', listingId)
      .order('year, month');

    console.log('Found', reservations?.length || 0, 'reservations');

    // Calculate monthly revenue by year
    const monthlyData: Record<number, Record<number, { revenue: number; bookings: number }>> = {};
    
    reservations?.forEach(res => {
      const checkIn = new Date(res.check_in);
      const resYear = checkIn.getFullYear();
      const resMonth = checkIn.getMonth() + 1;
      
      if (!monthlyData[resYear]) monthlyData[resYear] = {};
      if (!monthlyData[resYear][resMonth]) {
        monthlyData[resYear][resMonth] = { revenue: 0, bookings: 0 };
      }
      
      monthlyData[resYear][resMonth].revenue += Number(res.fare_accommodation_adjusted || 0);
      monthlyData[resYear][resMonth].bookings += 1;
    });

    // Prepare data summary for AI
    const historicalSummary = Object.entries(monthlyData).map(([yr, months]) => {
      const monthSummary = Object.entries(months).map(([m, data]) => ({
        month: m,
        revenue: data.revenue,
        bookings: data.bookings
      }));
      return { year: yr, months: monthSummary };
    });

    const propertyContext = {
      type: listing.property_type,
      bedrooms: listing.bedrooms,
      accommodates: listing.accommodates,
      location: listing.address,
      nickname: listing.nickname
    };

    const systemPrompt = `You are an expert revenue management consultant for vacation rental properties. 
Analyze historical booking data and property characteristics to generate intelligent monthly revenue goals.

Generate three tiers of monthly goals:
1. Budget (Conservative): 90th percentile of historical lows, accounting for worst-case scenarios
2. Projection (Expected): Realistic target based on historical averages and growth trends
3. Goal (Optimistic): Stretch target based on historical peaks and market opportunities

Consider:
- Seasonal patterns and trends
- Year-over-year growth rates
- Property characteristics and location advantages
- Market positioning (beachfront premium, size)
- Booking velocity and lead times

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "goals": [
    {"month": 1, "budget": 5000, "projection": 7000, "goal": 9000},
    ... (12 months total)
  ],
  "reasoning": "Brief explanation of the overall strategy and key seasonal insights"
}`;

    const userPrompt = `Generate monthly revenue goals for ${year}.

Property Details:
${JSON.stringify(propertyContext, null, 2)}

Historical Monthly Performance:
${JSON.stringify(historicalSummary, null, 2)}

Existing Goals (for reference):
${existingGoals && existingGoals.length > 0 ? JSON.stringify(existingGoals, null, 2) : 'None'}

Target Year: ${year}`;

    console.log('Calling Lovable AI...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI gateway error:', aiResponse.status, errorText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices[0].message.content;
    
    console.log('AI Response:', aiContent);

    // Parse the JSON response
    const suggestions = JSON.parse(aiContent);

    return new Response(
      JSON.stringify(suggestions),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in suggest-property-goals:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
