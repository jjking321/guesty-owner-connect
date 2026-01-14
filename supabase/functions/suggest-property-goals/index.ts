import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const YOY_GROWTH_RATE = 0.05; // 5% year-over-year growth
const RAMP_UP_MULTIPLIER = 0.70; // 70% of goal during ramp-up months
const RAMP_UP_MONTHS = 2; // First 2 full months after listing are ramp-up

interface MonthlyActual {
  month: number;
  revenue: number;
}

interface CompsetMonthlyAverage {
  month: string;
  avg_revenue?: number;
  avg_adr?: number;
  avg_occupancy?: number;
  avg_revpar?: number;
}

interface GoalResult {
  month: number;
  projection: number;
  source: 'actuals' | 'compset' | 'fallback';
  isRampUp: boolean;
  isPreListing: boolean;
}

// Outlier detection using IQR method
function calculateTrimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length <= 4) {
    // Too few values, use median
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  const filtered = values.filter(v => v >= lowerBound && v <= upperBound);
  
  if (filtered.length === 0) {
    // If all values are outliers, return median
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

// Round to nearest $100
function roundTo(n: number, base = 100): number {
  return Math.round((n || 0) / base) * base;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId, year } = await req.json();
    console.log('Generating smart goals for listing:', listingId, 'year:', year);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Fetch property details including created_at_guesty and is_composite
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, nickname, property_type, bedrooms, accommodates, address, created_at_guesty, is_composite')
      .eq('id', listingId)
      .single();

    if (listingError) throw listingError;

    // If this is a composite listing, return $0 goals
    if (listing?.is_composite) {
      console.log('Composite listing detected, returning $0 goals');
      return new Response(
        JSON.stringify({
          goals: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            projection: 0,
            source: 'composite',
            isRampUp: false,
            isPreListing: false,
          })),
          reasoning: 'Composite ("Full") listing - revenue is distributed to individual units. Goals are tracked at the unit level.',
          dataSource: 'composite',
          metadata: {
            isComposite: true,
            hasFullYearActuals: false,
            actualsMonths: 0,
            compsetMonths: 0,
            rampUpMonths: 0,
            preListingMonths: 0,
            yoyGrowthRate: 0,
            propertyStartDate: null,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine property management start date
    const createdAtGuesty = listing.created_at_guesty ? new Date(listing.created_at_guesty) : null;
    const listingStartYear = createdAtGuesty ? createdAtGuesty.getFullYear() : null;
    const listingStartMonth = createdAtGuesty ? createdAtGuesty.getMonth() + 1 : null; // 1-12
    
    console.log('Property start date:', createdAtGuesty, 'Year:', listingStartYear, 'Month:', listingStartMonth);

    // Step 2: Fetch last year's actual revenue from reservation_nights
    const previousYear = year - 1;
    const { data: lastYearActuals, error: actualsError } = await supabase
      .from('reservation_nights')
      .select('night_date, revenue_allocation')
      .eq('listing_id', listingId)
      .gte('night_date', `${previousYear}-01-01`)
      .lte('night_date', `${previousYear}-12-31`);

    if (actualsError) {
      console.error('Error fetching actuals:', actualsError);
    }

    // Aggregate actuals by month
    const monthlyActuals: MonthlyActual[] = [];
    const actualsByMonth: Record<number, number> = {};
    
    if (lastYearActuals && lastYearActuals.length > 0) {
      lastYearActuals.forEach(night => {
        const date = new Date(night.night_date);
        const month = date.getMonth() + 1;
        if (!actualsByMonth[month]) actualsByMonth[month] = 0;
        actualsByMonth[month] += Number(night.revenue_allocation) || 0;
      });
      
      for (let m = 1; m <= 12; m++) {
        if (actualsByMonth[m] && actualsByMonth[m] > 0) {
          monthlyActuals.push({ month: m, revenue: actualsByMonth[m] });
        }
      }
    }

    const hasFullYearActuals = monthlyActuals.length === 12;
    console.log('Last year actuals:', monthlyActuals.length, 'months. Full year:', hasFullYearActuals);

    // Step 3: Fetch compset monthly averages as fallback
    let compsetAverages: CompsetMonthlyAverage[] = [];
    const { data: compsetSummary, error: compsetError } = await supabase
      .from('property_compset_summary')
      .select('monthly_averages')
      .eq('listing_id', listingId)
      .single();

    if (compsetError) {
      console.log('No compset summary found:', compsetError.message);
    } else if (compsetSummary?.monthly_averages) {
      compsetAverages = compsetSummary.monthly_averages as CompsetMonthlyAverage[];
      console.log('Compset averages found for', compsetAverages.length, 'months');
    }

    // Parse compset data into a lookup by month number
    const compsetByMonth: Record<number, number> = {};
    compsetAverages.forEach(ca => {
      // monthly_averages has month in format "YYYY-MM", extract last month value
      const monthStr = ca.month;
      if (monthStr) {
        const monthNum = parseInt(monthStr.split('-')[1]);
        if (ca.avg_revenue && ca.avg_revenue > 0) {
          if (!compsetByMonth[monthNum]) {
            compsetByMonth[monthNum] = ca.avg_revenue;
          } else {
            // Average multiple years for the same month
            compsetByMonth[monthNum] = (compsetByMonth[monthNum] + ca.avg_revenue) / 2;
          }
        }
      }
    });

    // Step 4: Calculate goals using priority hierarchy
    const goalResults: GoalResult[] = [];
    let dataSource: 'actuals' | 'compset' | 'fallback' = 'fallback';

    for (let month = 1; month <= 12; month++) {
      // Check if this month is before property was listed (in target year)
      let isPreListing = false;
      if (listingStartYear && listingStartYear === year && listingStartMonth && month < listingStartMonth) {
        isPreListing = true;
      }

      // Check if this is a ramp-up month (first RAMP_UP_MONTHS after listing in target year)
      let isRampUp = false;
      if (listingStartYear === year && listingStartMonth) {
        const monthsAfterStart = month - listingStartMonth;
        // The listing month itself and the next RAMP_UP_MONTHS-1 months are ramp-up
        if (monthsAfterStart >= 0 && monthsAfterStart < RAMP_UP_MONTHS) {
          isRampUp = true;
        }
      }

      let projection = 0;
      let source: 'actuals' | 'compset' | 'fallback' = 'fallback';

      if (isPreListing) {
        // Property wasn't managed yet
        projection = 0;
        source = 'fallback';
      } else if (hasFullYearActuals && actualsByMonth[month]) {
        // Use last year actuals with growth
        projection = actualsByMonth[month] * (1 + YOY_GROWTH_RATE);
        source = 'actuals';
        dataSource = 'actuals';
      } else if (actualsByMonth[month] && actualsByMonth[month] > 0) {
        // Have partial actuals for this month - use them with growth
        projection = actualsByMonth[month] * (1 + YOY_GROWTH_RATE);
        source = 'actuals';
        if (dataSource === 'fallback') dataSource = 'actuals';
      } else if (compsetByMonth[month] && compsetByMonth[month] > 0) {
        // Use compset average for missing months
        projection = compsetByMonth[month];
        source = 'compset';
        if (dataSource === 'fallback') dataSource = 'compset';
      } else {
        // Final fallback: average of available actuals or compset
        const availableActuals = Object.values(actualsByMonth).filter(v => v > 0);
        const availableCompset = Object.values(compsetByMonth).filter(v => v > 0);
        
        if (availableActuals.length > 0) {
          projection = calculateTrimmedMean(availableActuals);
        } else if (availableCompset.length > 0) {
          projection = calculateTrimmedMean(availableCompset);
        }
        source = 'fallback';
      }

      // Apply ramp-up multiplier
      if (isRampUp && projection > 0) {
        projection = projection * RAMP_UP_MULTIPLIER;
      }

      goalResults.push({
        month,
        projection: roundTo(projection),
        source,
        isRampUp,
        isPreListing,
      });
    }

    // Step 5: Use AI for refinement and insights (optional enhancement)
    let reasoning = '';
    
    // Build reasoning based on data sources
    const actualsCount = goalResults.filter(g => g.source === 'actuals').length;
    const compsetCount = goalResults.filter(g => g.source === 'compset').length;
    const rampUpCount = goalResults.filter(g => g.isRampUp).length;
    const preListingCount = goalResults.filter(g => g.isPreListing).length;

    if (hasFullYearActuals) {
      reasoning = `Based on ${previousYear} actual performance with ${Math.round(YOY_GROWTH_RATE * 100)}% YoY growth applied.`;
    } else if (actualsCount > 0 && compsetCount > 0) {
      reasoning = `Blended approach: ${actualsCount} months from ${previousYear} actuals (+${Math.round(YOY_GROWTH_RATE * 100)}% growth), ${compsetCount} months from compset historical averages.`;
    } else if (compsetCount > 0) {
      reasoning = `Based on historical compset performance averages (${compsetCount} months of data).`;
    } else {
      reasoning = `Limited historical data available. Goals based on estimated averages.`;
    }

    if (preListingCount > 0) {
      reasoning += ` ${preListingCount} months set to $0 (property not yet under management).`;
    }

    if (rampUpCount > 0) {
      reasoning += ` ${rampUpCount} months at ${Math.round(RAMP_UP_MULTIPLIER * 100)}% (new property ramp-up period).`;
    }

    // Try AI refinement for additional insights
    try {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { 
              role: 'system', 
              content: `You are a vacation rental revenue analyst. Provide a brief (1-2 sentence) insight about the projected goals. Focus on seasonality patterns or recommendations. Do not output JSON.`
            },
            { 
              role: 'user', 
              content: `Property: ${listing.nickname || 'Vacation Rental'} (${listing.bedrooms || '?'} BR, ${listing.property_type || 'Property'})
Monthly goals for ${year}:
${goalResults.map(g => `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][g.month-1]}: $${g.projection.toLocaleString()}${g.isRampUp ? ' (ramp-up)' : ''}${g.isPreListing ? ' (pre-listing)' : ''}`).join('\n')}

Data source: ${dataSource}. Provide a brief insight.`
            }
          ],
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const aiInsight = aiData.choices?.[0]?.message?.content?.trim();
        if (aiInsight && aiInsight.length < 300) {
          reasoning += ' ' + aiInsight;
        }
      }
    } catch (aiError) {
      console.log('AI refinement skipped:', aiError);
    }

    // Format response
    const goals = goalResults.map(g => ({
      month: g.month,
      projection: g.projection,
      source: g.source,
      isRampUp: g.isRampUp,
      isPreListing: g.isPreListing,
    }));

    console.log('Generated goals:', goals.map(g => `M${g.month}: $${g.projection} (${g.source})`).join(', '));

    return new Response(
      JSON.stringify({ 
        goals, 
        reasoning,
        dataSource,
        metadata: {
          hasFullYearActuals,
          actualsMonths: monthlyActuals.length,
          compsetMonths: Object.keys(compsetByMonth).length,
          rampUpMonths: rampUpCount,
          preListingMonths: preListingCount,
          yoyGrowthRate: YOY_GROWTH_RATE,
          propertyStartDate: createdAtGuesty?.toISOString() || null,
        }
      }),
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