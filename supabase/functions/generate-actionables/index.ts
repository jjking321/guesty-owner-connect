import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Issue {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  title: string;
  description: string;
  affected_dates?: string[];
  revenue_impact?: number;
  data_snapshot?: Record<string, unknown>;
}

interface PropertyData {
  id: string;
  nickname: string;
  thumbnail: string;
  live_airbnb_rating: number | null;
  organization_id: string;
}

// Revenue-focused priority scoring
const CATEGORY_SCORES: Record<string, number> = {
  'unbookable_gap': 35,      // Direct revenue loss, easily fixable
  'pricing_high': 28,        // Losing bookings = revenue loss
  'low_probability': 25,     // Revenue at risk  
  'pricing_low': 22,         // Leaving money on table
  'forecast_miss': 20,       // Goal tracking
  'low_rating': 20,          // Less immediately actionable
  'yoy_pacing_gap': 15,      // Trend indicator
  'recent_low_review': 12,   // Informational
  'high_demand_available': 12, // Opportunity
  'missing_goals': 5,        // Administrative - lowest priority
};

function calculateIssueScore(issue: Partial<Issue>): number {
  let score = CATEGORY_SCORES[issue.category || ''] || 10;
  
  // Time urgency bonus
  if (issue.affected_dates && issue.affected_dates.length > 0) {
    const firstDate = new Date(issue.affected_dates[0]);
    const today = new Date();
    const daysUntil = Math.floor((firstDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntil <= 7) score += 15;
    else if (daysUntil <= 14) score += 10;
    else if (daysUntil <= 30) score += 5;
  }
  
  // Revenue impact bonus
  if (issue.revenue_impact) {
    if (issue.revenue_impact >= 2000) score += 15;
    else if (issue.revenue_impact >= 1000) score += 10;
    else if (issue.revenue_impact >= 500) score += 5;
  }
  
  return score;
}

function getPriority(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 40) return 'critical';
  if (score >= 30) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function calculatePropertyScore(issues: Issue[]): number {
  const baseScore = issues.reduce((sum, i) => sum + i.score, 0);
  const multiplier = 1 + (issues.length * 0.1);
  return Math.round(baseScore * multiplier);
}

async function generateAISummary(
  property: PropertyData,
  issues: Issue[],
  apiKey: string
): Promise<string | null> {
  try {
    const prompt = `You are a revenue management assistant analyzing a vacation rental property.

Property: ${property.nickname || 'Unknown Property'}
Current Airbnb Rating: ${property.live_airbnb_rating || 'N/A'}

Issues Found:
${issues.map(i => `- [${i.priority.toUpperCase()}] ${i.title}: ${i.description}`).join('\n')}

Generate a 2-3 sentence actionable summary prioritizing what the revenue manager should address first. Be specific with numbers and dates. Focus on immediate actions.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a concise revenue management assistant. Provide actionable insights in 2-3 sentences.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.error('AI API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== Generate Actionables Started ===');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Get all active listings with their organization
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        id,
        nickname,
        thumbnail,
        live_airbnb_rating,
        guesty_account_id,
        guesty_accounts!inner (
          organization_id,
          actionables_generation_enabled
        )
      `)
      .eq('archived', false)
      .eq('active', true)
      .eq('guesty_accounts.actionables_generation_enabled', true);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    if (!listings || listings.length === 0) {
      console.log('No listings found with actionables enabled');
      return new Response(
        JSON.stringify({ success: true, message: 'No listings to process', properties_processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${listings.length} listings`);

    const today = new Date().toISOString().split('T')[0];
    const sixtyDaysLater = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const ninetyDaysLater = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // Fetch all data we need in parallel
    const [
      calendarResult,
      probabilitiesResult,
      forecastsResult,
      goalsResult,
      reviewsResult,
      compsetResult,
    ] = await Promise.all([
      // Calendar data for unbookable gaps AND pricing comparison
      supabase
        .from('capacity_calendar')
        .select('listing_id, date, min_nights, is_available, price')
        .eq('is_available', true)
        .gte('date', today)
        .lte('date', ninetyDaysLater)
        .order('listing_id')
        .order('date'),
      
      // Booking probabilities
      supabase
        .from('booking_probabilities')
        .select('listing_id, date, probability, your_price')
        .gte('date', today)
        .lte('date', thirtyDaysLater)
        .lt('probability', 0.3),
      
      // Revenue forecasts
      supabase
        .from('revenue_forecasts')
        .select('listing_id, year, monthly_forecasts')
        .eq('year', currentYear),
      
      // Property goals - fetch ALL goal records for current year
      // Explicitly set high limit since default is 1000 and we may have 4000+ records
      supabase
        .from('property_goals')
        .select('listing_id, year, month, goal_revenue')
        .eq('year', currentYear)
        .gte('month', currentMonth)
        .limit(10000),
      
      // Recent low reviews
      supabase
        .from('reviews')
        .select('listing_id, rating, review_date, review_text, guest_name')
        .gte('review_date', thirtyDaysAgo)
        .lt('rating', 4)
        .eq('is_removed', false),
      
      // Compset summaries for pricing comparison - include monthly_averages for ADR data
      supabase
        .from('property_compset_summary')
        .select('listing_id, future_monthly_averages, monthly_averages'),
    ]);

    // Build lookup maps
    const calendarByListing = new Map<string, Array<{ date: string; min_nights: number; price: number }>>();
    if (calendarResult.data) {
      for (const row of calendarResult.data) {
        if (!calendarByListing.has(row.listing_id)) {
          calendarByListing.set(row.listing_id, []);
        }
        calendarByListing.get(row.listing_id)!.push({ 
          date: row.date, 
          min_nights: row.min_nights || 1,
          price: row.price || 0
        });
      }
    }

    const probabilitiesByListing = new Map<string, Array<{ date: string; probability: number; price: number }>>();
    if (probabilitiesResult.data) {
      for (const row of probabilitiesResult.data) {
        if (!probabilitiesByListing.has(row.listing_id)) {
          probabilitiesByListing.set(row.listing_id, []);
        }
        probabilitiesByListing.get(row.listing_id)!.push({
          date: row.date,
          probability: row.probability || 0,
          price: row.your_price || 0,
        });
      }
    }

    const forecastsByListing = new Map<string, Record<string, unknown>>();
    if (forecastsResult.data) {
      for (const row of forecastsResult.data) {
        forecastsByListing.set(row.listing_id, row.monthly_forecasts as Record<string, unknown>);
      }
    }

    // Goals lookup - track which months have goal RECORDS (not just positive values)
    const goalsByListing = new Map<string, Array<{ month: number; goal: number }>>();
    if (goalsResult.data) {
      for (const row of goalsResult.data) {
        if (!goalsByListing.has(row.listing_id)) {
          goalsByListing.set(row.listing_id, []);
        }
        goalsByListing.get(row.listing_id)!.push({
          month: row.month,
          goal: row.goal_revenue || 0,
        });
      }
    }

    const reviewsByListing = new Map<string, Array<{ rating: number; date: string; text: string }>>();
    if (reviewsResult.data) {
      for (const row of reviewsResult.data) {
        if (!reviewsByListing.has(row.listing_id)) {
          reviewsByListing.set(row.listing_id, []);
        }
        reviewsByListing.get(row.listing_id)!.push({
          rating: row.rating || 0,
          date: row.review_date || '',
          text: (row.review_text || '').substring(0, 100),
        });
      }
    }

    // Compset lookup - use monthly_averages which has ADR data
    const compsetByListing = new Map<string, Array<{ month: string; adr: number; occupancy: number }>>();
    if (compsetResult.data) {
      for (const row of compsetResult.data) {
        const monthlyData = row.monthly_averages as Array<{ month: string; adr: number; occupancy: number }> || [];
        if (Array.isArray(monthlyData) && monthlyData.length > 0) {
          compsetByListing.set(row.listing_id, monthlyData);
        }
      }
    }

    // Process each listing
    const propertyActionables: Array<{
      listing_id: string;
      organization_id: string;
      issues: Issue[];
      aggregate_score: number;
      critical_count: number;
      high_count: number;
      medium_count: number;
      low_count: number;
      ai_summary: string | null;
    }> = [];

    for (const listing of listings) {
      const issues: Issue[] = [];
      const guestyAccount = listing.guesty_accounts as unknown as { organization_id: string };
      const orgId = guestyAccount.organization_id;

      // 1. Check for unbookable gaps
      const calendar = calendarByListing.get(listing.id) || [];
      if (calendar.length > 0) {
        // Find consecutive date ranges
        let gapStart: string | null = null;
        let gapDates: string[] = [];
        let maxMinNights = 1;

        for (let i = 0; i < calendar.length; i++) {
          const current = calendar[i];
          const prev = i > 0 ? calendar[i - 1] : null;
          
          const currentDate = new Date(current.date);
          const prevDate = prev ? new Date(prev.date) : null;
          const daysDiff = prevDate ? Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)) : 1;

          if (daysDiff === 1 && gapStart) {
            // Continue the gap
            gapDates.push(current.date);
            maxMinNights = Math.max(maxMinNights, current.min_nights);
          } else {
            // Check if previous gap was unbookable
            if (gapDates.length > 0 && gapDates.length < maxMinNights) {
              const issue: Issue = {
                category: 'unbookable_gap',
                priority: 'critical',
                score: 0,
                title: `Unbookable Gap: ${gapDates.length} nights (min ${maxMinNights} required)`,
                description: `Available dates ${gapStart} to ${gapDates[gapDates.length - 1]} cannot be booked because min nights (${maxMinNights}) exceeds gap length (${gapDates.length}).`,
                affected_dates: [...gapDates],
                data_snapshot: { gap_length: gapDates.length, min_nights: maxMinNights },
              };
              issue.score = calculateIssueScore(issue);
              issue.priority = getPriority(issue.score);
              issues.push(issue);
            }

            // Start new gap
            gapStart = current.date;
            gapDates = [current.date];
            maxMinNights = current.min_nights;
          }
        }

        // Check final gap
        if (gapDates.length > 0 && gapDates.length < maxMinNights) {
          const issue: Issue = {
            category: 'unbookable_gap',
            priority: 'critical',
            score: 0,
            title: `Unbookable Gap: ${gapDates.length} nights (min ${maxMinNights} required)`,
            description: `Available dates ${gapStart} to ${gapDates[gapDates.length - 1]} cannot be booked because min nights (${maxMinNights}) exceeds gap length (${gapDates.length}).`,
            affected_dates: [...gapDates],
            data_snapshot: { gap_length: gapDates.length, min_nights: maxMinNights },
          };
          issue.score = calculateIssueScore(issue);
          issue.priority = getPriority(issue.score);
          issues.push(issue);
        }
      }

      // 2. Check for low rating - ONLY if rating > 0 (0 means no reviews yet)
      if (listing.live_airbnb_rating !== null && listing.live_airbnb_rating > 0) {
        if (listing.live_airbnb_rating < 4.3) {
          const issue: Issue = {
            category: 'low_rating',
            priority: 'critical',
            score: 0,
            title: `Critical Rating Alert: ${listing.live_airbnb_rating.toFixed(1)}`,
            description: `Airbnb rating has dropped below 4.3. This significantly impacts search visibility and booking rates.`,
            data_snapshot: { current_rating: listing.live_airbnb_rating },
          };
          issue.score = calculateIssueScore(issue) + 10; // Extra penalty for critical rating
          issue.priority = getPriority(issue.score);
          issues.push(issue);
        } else if (listing.live_airbnb_rating < 4.5) {
          const issue: Issue = {
            category: 'low_rating',
            priority: 'high',
            score: 0,
            title: `Rating Warning: ${listing.live_airbnb_rating.toFixed(1)}`,
            description: `Airbnb rating is below 4.5. Consider addressing recent guest feedback to improve.`,
            data_snapshot: { current_rating: listing.live_airbnb_rating },
          };
          issue.score = calculateIssueScore(issue);
          issue.priority = getPriority(issue.score);
          issues.push(issue);
        }
      }

      // 3. Check for low probability dates
      const probabilities = probabilitiesByListing.get(listing.id) || [];
      if (probabilities.length >= 3) {
        const avgProb = probabilities.reduce((sum, p) => sum + p.probability, 0) / probabilities.length;
        const dates = probabilities.map(p => p.date).slice(0, 10);
        const avgPrice = probabilities.reduce((sum, p) => sum + p.price, 0) / probabilities.length;

        const issue: Issue = {
          category: 'low_probability',
          priority: 'high',
          score: 0,
          title: `${probabilities.length} dates with low booking probability`,
          description: `${probabilities.length} dates in the next 30 days have <30% booking probability (avg ${(avgProb * 100).toFixed(0)}%). Average rate: $${avgPrice.toFixed(0)}/night.`,
          affected_dates: dates,
          data_snapshot: { count: probabilities.length, avg_probability: avgProb, avg_rate: avgPrice },
        };
        issue.score = calculateIssueScore(issue);
        issue.priority = getPriority(issue.score);
        issues.push(issue);
      }

      // 4. Check forecast vs goals
      const forecasts = forecastsByListing.get(listing.id);
      const goals = goalsByListing.get(listing.id) || [];
      
      if (forecasts && goals.length > 0) {
        for (const goal of goals) {
          if (goal.goal <= 0) continue; // Only check goals with actual positive values
          
          const monthIndex = goal.month - 1;
          const monthForecast = forecasts[monthIndex.toString()] as { p50?: number } | undefined;
          const forecastP50 = monthForecast?.p50 || 0;
          
          if (forecastP50 > 0 && forecastP50 < goal.goal * 0.8) {
            const gap = goal.goal - forecastP50;
            const pct = ((forecastP50 / goal.goal) * 100).toFixed(0);
            
            const issue: Issue = {
              category: 'forecast_miss',
              priority: 'high',
              score: 0,
              title: `Month ${goal.month} forecast gap: -$${gap.toFixed(0)}`,
              description: `Forecast ($${forecastP50.toFixed(0)}) is ${pct}% of goal ($${goal.goal.toFixed(0)}). ${((1 - forecastP50/goal.goal) * 100).toFixed(0)}% shortfall expected.`,
              revenue_impact: gap,
              data_snapshot: { month: goal.month, forecast: forecastP50, goal: goal.goal },
            };
            issue.score = calculateIssueScore(issue);
            issue.priority = getPriority(issue.score);
            issues.push(issue);
          }
        }
      }

      // 5. Check for recent low reviews
      const reviews = reviewsByListing.get(listing.id) || [];
      if (reviews.length > 0) {
        const issue: Issue = {
          category: 'recent_low_review',
          priority: 'medium',
          score: 0,
          title: `${reviews.length} low review${reviews.length > 1 ? 's' : ''} in last 30 days`,
          description: `Recent reviews with ratings below 4 stars. Latest: "${reviews[0].text}..."`,
          data_snapshot: { count: reviews.length, reviews: reviews.slice(0, 3) },
        };
        issue.score = calculateIssueScore(issue);
        issue.priority = getPriority(issue.score);
        issues.push(issue);
      }

      // 6. Check for missing goals - check if goal RECORD exists, not just positive value
      const upcomingMonths = [currentMonth, currentMonth + 1, currentMonth + 2].filter(m => m <= 12);
      const monthsWithGoals = new Set(goals.map(g => g.month)); // Fixed: check record existence
      const missingGoalMonths = upcomingMonths.filter(m => !monthsWithGoals.has(m));
      
      if (missingGoalMonths.length > 0) {
        const monthNames = missingGoalMonths.map(m => 
          new Date(currentYear, m - 1).toLocaleString('default', { month: 'short' })
        );
        
        const issue: Issue = {
          category: 'missing_goals',
          priority: 'low',
          score: 0,
          title: `Missing goals for ${monthNames.join(', ')}`,
          description: `No revenue goals set for upcoming months. Set goals to track performance.`,
          data_snapshot: { missing_months: missingGoalMonths },
        };
        issue.score = calculateIssueScore(issue);
        issue.priority = getPriority(issue.score);
        issues.push(issue);
      }

      // 7. NEW: Check pricing vs compset
      const compsetData = compsetByListing.get(listing.id);
      if (compsetData && compsetData.length > 0 && calendar.length > 0) {
        // Group calendar prices by month (YYYY-MM format)
        const pricesByMonth: Record<string, { prices: number[]; dates: string[] }> = {};
        
        for (const day of calendar) {
          if (day.price && day.price > 0) {
            const month = day.date.substring(0, 7); // "2026-02"
            if (!pricesByMonth[month]) pricesByMonth[month] = { prices: [], dates: [] };
            pricesByMonth[month].prices.push(day.price);
            pricesByMonth[month].dates.push(day.date);
          }
        }
        
        // Compare each month against compset ADR
        for (const [month, data] of Object.entries(pricesByMonth)) {
          const yourAvgRate = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
          
          // Find matching compset month
          const compsetMonth = compsetData.find((m) => m.month === month);
          
          if (compsetMonth?.adr && compsetMonth.adr > 0) {
            const priceDiff = (yourAvgRate - compsetMonth.adr) / compsetMonth.adr;
            
            if (priceDiff > 0.20) {
              // Overpriced by 20%+ - may be losing bookings
              const issue: Issue = {
                category: 'pricing_high',
                priority: 'high',
                score: 0,
                title: `${month} rates ${Math.round(priceDiff * 100)}% above market`,
                description: `Your avg $${yourAvgRate.toFixed(0)}/night vs compset $${compsetMonth.adr.toFixed(0)}. ${data.prices.length} available nights may be overpriced.`,
                revenue_impact: data.prices.length * yourAvgRate * 0.3, // Assume 30% booking loss
                affected_dates: data.dates.slice(0, 5),
                data_snapshot: { 
                  your_rate: yourAvgRate, 
                  compset_adr: compsetMonth.adr, 
                  diff_pct: Math.round(priceDiff * 100),
                  nights: data.prices.length 
                },
              };
              issue.score = calculateIssueScore(issue);
              issue.priority = getPriority(issue.score);
              issues.push(issue);
            } else if (priceDiff < -0.25) {
              // Underpriced by 25%+ - leaving money on table
              const missedRevenue = data.prices.length * (compsetMonth.adr - yourAvgRate);
              const issue: Issue = {
                category: 'pricing_low',
                priority: 'high',
                score: 0,
                title: `${month} rates ${Math.abs(Math.round(priceDiff * 100))}% below market`,
                description: `Your avg $${yourAvgRate.toFixed(0)}/night vs compset $${compsetMonth.adr.toFixed(0)}. Potential +$${missedRevenue.toFixed(0)} opportunity.`,
                revenue_impact: missedRevenue,
                affected_dates: data.dates.slice(0, 5),
                data_snapshot: { 
                  your_rate: yourAvgRate, 
                  compset_adr: compsetMonth.adr, 
                  diff_pct: Math.round(priceDiff * 100),
                  nights: data.prices.length,
                  missed_revenue: missedRevenue
                },
              };
              issue.score = calculateIssueScore(issue);
              issue.priority = getPriority(issue.score);
              issues.push(issue);
            }
          }
        }
      }

      // Only create actionable if there are issues
      if (issues.length > 0) {
        const aggregateScore = calculatePropertyScore(issues);
        const criticalCount = issues.filter(i => i.priority === 'critical').length;
        const highCount = issues.filter(i => i.priority === 'high').length;
        const mediumCount = issues.filter(i => i.priority === 'medium').length;
        const lowCount = issues.filter(i => i.priority === 'low').length;

        propertyActionables.push({
          listing_id: listing.id,
          organization_id: orgId,
          issues,
          aggregate_score: aggregateScore,
          critical_count: criticalCount,
          high_count: highCount,
          medium_count: mediumCount,
          low_count: lowCount,
          ai_summary: null,
        });
      }
    }

    // Sort by aggregate score (highest first)
    propertyActionables.sort((a, b) => b.aggregate_score - a.aggregate_score);

    // Generate AI summaries for top 20 properties
    console.log(`Generating AI summaries for top ${Math.min(20, propertyActionables.length)} properties`);
    
    const topProperties = propertyActionables.slice(0, 20);
    for (const prop of topProperties) {
      const listing = listings.find(l => l.id === prop.listing_id);
      if (listing) {
        prop.ai_summary = await generateAISummary(
          {
            id: listing.id,
            nickname: listing.nickname || 'Unknown',
            thumbnail: listing.thumbnail || '',
            live_airbnb_rating: listing.live_airbnb_rating,
            organization_id: prop.organization_id,
          },
          prop.issues,
          LOVABLE_API_KEY
        );
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Clear existing non-dismissed actionables and insert new ones
    console.log('Saving actionables to database...');
    
    // Delete old non-dismissed entries
    const { error: deleteError } = await supabase
      .from('property_actionables')
      .delete()
      .eq('dismissed', false);

    if (deleteError) {
      console.error('Error deleting old actionables:', deleteError);
    }

    // Insert new actionables in batches
    const batchSize = 50;
    for (let i = 0; i < propertyActionables.length; i += batchSize) {
      const batch = propertyActionables.slice(i, i + batchSize).map(p => ({
        listing_id: p.listing_id,
        organization_id: p.organization_id,
        total_issue_count: p.issues.length,
        critical_count: p.critical_count,
        high_count: p.high_count,
        medium_count: p.medium_count,
        low_count: p.low_count,
        aggregate_score: p.aggregate_score,
        issues: p.issues,
        ai_summary: p.ai_summary,
        generated_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('property_actionables')
        .insert(batch);

      if (insertError) {
        console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`=== Generate Actionables Completed in ${duration}s ===`);
    console.log(`Properties with issues: ${propertyActionables.length}`);
    console.log(`Total issues: ${propertyActionables.reduce((sum, p) => sum + p.issues.length, 0)}`);

    return new Response(
      JSON.stringify({
        success: true,
        properties_processed: listings.length,
        properties_with_issues: propertyActionables.length,
        total_issues: propertyActionables.reduce((sum, p) => sum + p.issues.length, 0),
        duration: `${duration}s`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Generate actionables error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
