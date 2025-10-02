import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId, year = new Date().getFullYear(), simulations = 10000 } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Forecasting revenue for listing ${listingId}, year ${year}`);

    // Fetch all reservations for this property (2+ years of history)
    const { data: reservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('*')
      .eq('listing_id', listingId)
      .eq('status', 'confirmed')
      .gte('check_in', `${year - 2}-01-01`)
      .order('check_in', { ascending: true });

    if (reservationsError) throw reservationsError;

    // Fetch goals for this year
    const { data: goals, error: goalsError } = await supabase
      .from('property_goals')
      .select('*')
      .eq('listing_id', listingId)
      .eq('year', year);

    if (goalsError) throw goalsError;

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = year;
    const isFutureYear = currentYear > today.getFullYear();

    // Calculate revenue already on the books (all confirmed reservations for this year)
    const revenueOnBooks = reservations
      ?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === currentYear && 
               r.fare_accommodation_adjusted;
      })
      .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

    // Calculate revenue from past months (actual completed revenue)
    const pastRevenue = isFutureYear ? 0 : reservations
      ?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === currentYear && 
               checkIn.getMonth() < currentMonth &&
               r.fare_accommodation_adjusted;
      })
      .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

    // Calculate confirmed future bookings
    const futureConfirmed = revenueOnBooks - pastRevenue;

    // Analyze booking window (lead time distribution)
    const bookingWindowData: { [month: number]: number[] } = {};
    reservations?.forEach(r => {
      if (r.created_at_guesty && r.check_in) {
        const checkInMonth = new Date(r.check_in).getMonth();
        const createdAt = new Date(r.created_at_guesty);
        const checkIn = new Date(r.check_in);
        const leadDays = Math.floor((checkIn.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        
        if (!bookingWindowData[checkInMonth]) bookingWindowData[checkInMonth] = [];
        if (leadDays >= 0) bookingWindowData[checkInMonth].push(leadDays);
      }
    });

    // Calculate percentiles for booking windows
    const percentile = (arr: number[], p: number) => {
      const sorted = arr.sort((a, b) => a - b);
      const index = Math.ceil(sorted.length * p) - 1;
      return sorted[Math.max(0, index)] || 0;
    };

    const windowStats = Object.entries(bookingWindowData).map(([month, days]) => ({
      month: parseInt(month),
      p10: percentile(days, 0.1),
      p50: percentile(days, 0.5),
      p90: percentile(days, 0.9),
      mean: days.reduce((a, b) => a + b, 0) / days.length
    }));

    // Calculate booking velocity (current year vs last year)
    const velocityByMonth: { [month: number]: number } = {};
    for (let month = currentMonth + 1; month < 12; month++) {
      const currentYearCount = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        const createdAt = new Date(r.created_at_guesty || r.check_in);
        return checkIn.getFullYear() === currentYear &&
               checkIn.getMonth() === month &&
               createdAt <= today;
      }).length || 0;

      const lastYearSameDay = new Date(currentYear - 1, today.getMonth(), today.getDate());
      const lastYearCount = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        const createdAt = new Date(r.created_at_guesty || r.check_in);
        return checkIn.getFullYear() === currentYear - 1 &&
               checkIn.getMonth() === month &&
               createdAt <= lastYearSameDay;
      }).length || 0;

      velocityByMonth[month] = lastYearCount > 0 ? currentYearCount / lastYearCount : 1;
    }

    // Calculate historical revenue by month
    const historicalRevenue: { [month: number]: number[] } = {};
    reservations?.forEach(r => {
      const checkIn = new Date(r.check_in);
      const month = checkIn.getMonth();
      const revenue = Number(r.fare_accommodation_adjusted) || 0;
      
      if (!historicalRevenue[month]) historicalRevenue[month] = [];
      if (revenue > 0) historicalRevenue[month].push(revenue);
    });

    const monthlyStats = Object.entries(historicalRevenue).map(([month, revenues]) => {
      const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
      const variance = revenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / revenues.length;
      const stdDev = Math.sqrt(variance);
      return {
        month: parseInt(month),
        mean,
        stdDev,
        count: revenues.length
      };
    });

    // Monte Carlo Simulation
    const normalSample = (mean: number, stdDev: number) => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    const simResults: number[] = [];
    
    // Determine which months to forecast
    const startMonth = isFutureYear ? 0 : currentMonth + 1;
    
    for (let sim = 0; sim < simulations; sim++) {
      // Start with past actual revenue + future confirmed bookings
      let simTotal = pastRevenue + futureConfirmed;
      
      // Add forecasted revenue for remaining months
      for (let month = startMonth; month < 12; month++) {
        const stats = monthlyStats.find(s => s.month === month);
        if (!stats) continue;

        const velocity = velocityByMonth[month] || 1;
        const windowStat = windowStats.find(w => w.month === month);
        
        // Calculate booking window adjustment
        const daysToMonth = Math.floor((new Date(currentYear, month, 15).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const windowAdjustment = windowStat ? 
          Math.min(1, Math.max(0.1, daysToMonth / windowStat.p50)) : 1;
        
        // Sample revenue with velocity and window adjustments
        const baseRevenue = normalSample(stats.mean * velocity, stats.stdDev);
        const adjustedRevenue = Math.max(0, baseRevenue * windowAdjustment * (0.8 + Math.random() * 0.4));
        
        simTotal += adjustedRevenue;
      }
      
      simResults.push(simTotal);
    }

    simResults.sort((a, b) => a - b);

    const forecastedRevenue = {
      p10: simResults[Math.floor(simulations * 0.1)],
      p25: simResults[Math.floor(simulations * 0.25)],
      p50: simResults[Math.floor(simulations * 0.5)],
      p75: simResults[Math.floor(simulations * 0.75)],
      p90: simResults[Math.floor(simulations * 0.9)]
    };

    // Calculate goal probabilities
    const totalBudget = goals?.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0) || 0;
    const totalProjection = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;
    const totalGoal = goals?.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0) || 0;

    const goalProbabilities = {
      budget: totalBudget > 0 ? (simResults.filter(s => s >= totalBudget).length / simulations) * 100 : 0,
      projection: totalProjection > 0 ? (simResults.filter(s => s >= totalProjection).length / simulations) * 100 : 0,
      goal: totalGoal > 0 ? (simResults.filter(s => s >= totalGoal).length / simulations) * 100 : 0
    };

    // Generate monthly forecasts
    const monthlyForecasts = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    for (let month = 0; month < 12; month++) {
      const isPastMonth = !isFutureYear && month < currentMonth;
      const isCurrentMonth = !isFutureYear && month === currentMonth;
      // Get actual revenue for this month
      const actualRevenue = reservations
        ?.filter(r => {
          const checkIn = new Date(r.check_in);
          return checkIn.getFullYear() === currentYear && 
                 checkIn.getMonth() === month &&
                 r.fare_accommodation_adjusted;
        })
        .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

      const stats = monthlyStats.find(s => s.month === month);
      const velocity = velocityByMonth[month] || 1;
      const windowStat = windowStats.find(w => w.month === month);
      const daysToMonth = Math.floor((new Date(currentYear, month, 15).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      let additionalP50 = 0;
      let additionalP10 = 0;
      let additionalP90 = 0;
      
      // Only forecast additional revenue for current and future months
      if (!isPastMonth) {
        additionalP50 = stats ? stats.mean * velocity * 0.7 : 0;
        additionalP10 = stats ? stats.mean * velocity * 0.4 : 0;
        additionalP90 = stats ? stats.mean * velocity * 1.0 : 0;
      }

      const windowStatus = windowStat ? 
        (daysToMonth > windowStat.p90 ? 'open' : 
         daysToMonth > windowStat.p50 ? 'closing' : 'closed') : 'open';

      monthlyForecasts.push({
        month,
        monthName: monthNames[month],
        isPast: isPastMonth,
        actualRevenue: isPastMonth ? actualRevenue : 0,
        revenueOnBooks: !isPastMonth ? actualRevenue : 0,
        forecastedAdditional: {
          p50: additionalP50,
          p10: additionalP10,
          p90: additionalP90
        },
        totalForecast: {
          p50: actualRevenue + additionalP50,
          p10: actualRevenue + additionalP10,
          p90: actualRevenue + additionalP90
        },
        bookingVelocity: velocity,
        bookingWindowStatus: windowStatus
      });
    }

    // Generate insights
    const insights = {
      keyDrivers: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[]
    };

    const avgVelocity = Object.values(velocityByMonth).reduce((a, b) => a + b, 0) / Object.values(velocityByMonth).length;
    if (avgVelocity > 1.1) {
      insights.keyDrivers.push(`Strong booking pace: ${((avgVelocity - 1) * 100).toFixed(0)}% ahead of last year`);
    } else if (avgVelocity < 0.9) {
      insights.risks.push(`Booking pace ${((1 - avgVelocity) * 100).toFixed(0)}% behind last year`);
    }

    if (goalProbabilities.goal < 30) {
      insights.risks.push('Low probability of hitting year-end goal based on current pace');
    }

    const closingSoon = monthlyForecasts.filter(m => m.bookingWindowStatus === 'closing').length;
    if (closingSoon > 0) {
      insights.opportunities.push(`${closingSoon} month(s) still accepting bookings - optimize pricing now`);
    }

    console.log(`Forecast complete: P50 = $${forecastedRevenue.p50.toFixed(0)}`);

    const goalTargets = {
      budget: totalBudget,
      projection: totalProjection,
      goal: totalGoal
    };

    const forecastData = {
      listingId,
      year,
      asOfDate: today.toISOString(),
      pastRevenue,
      futureConfirmed,
      revenueOnBooks,
      forecastedRevenue,
      totalForecast: {
        p50: forecastedRevenue.p50,
        confidence: {
          lower: simResults[Math.floor(simulations * 0.1)],
          upper: simResults[Math.floor(simulations * 0.9)]
        }
      },
      goalTargets,
      goalProbabilities,
      monthlyForecasts,
      insights
    };

    // Save forecast to database (upsert)
    const { error: saveError } = await supabase
      .from('revenue_forecasts')
      .upsert({
        listing_id: listingId,
        year,
        generated_at: today.toISOString(),
        revenue_on_books: revenueOnBooks,
        forecasted_revenue: forecastedRevenue,
        total_forecast: {
          ...forecastData.totalForecast,
          pastRevenue,
          futureConfirmed
        },
        goal_targets: goalTargets,
        goal_probabilities: goalProbabilities,
        monthly_forecasts: monthlyForecasts,
        insights
      }, {
        onConflict: 'listing_id,year'
      });

    if (saveError) {
      console.error('Error saving forecast:', saveError);
    } else {
      console.log('Forecast saved to database');
    }

    return new Response(
      JSON.stringify(forecastData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in forecast-revenue:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
