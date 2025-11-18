import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ForecastSettings {
  simulation_runs: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId, year = new Date().getFullYear(), simulations } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`\n=== RevPAR Velocity Forecast for listing ${listingId}, year ${year} ===\n`);

    // Load forecast settings
    const { data: settings } = await supabase
      .from('forecast_settings')
      .select('simulation_runs')
      .limit(1)
      .maybeSingle();

    const simulationCount = Math.min(simulations || settings?.simulation_runs || 1000, 1000);

    // Fetch ALL reservations (we need last year's data for baseline)
    const { data: reservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('id, listing_id, check_in, check_out, fare_accommodation_adjusted, nights_count, status, created_at_guesty')
      .eq('listing_id', listingId)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', `${year - 2}-01-01`)
      .order('check_in', { ascending: true });

    if (reservationsError) throw reservationsError;

    // Fetch property goals
    const { data: goals } = await supabase
      .from('property_goals')
      .select('*')
      .eq('listing_id', listingId)
      .eq('year', year);

    // Build baseline from last year's actual monthly revenue
    const baselineByMonth: Record<number, number> = {};
    const nightsByMonth: Record<number, number> = {};

    // Build baseline using night-based allocation
    reservations?.forEach(r => {
      if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
      
      const totalRevenue = Number(r.fare_accommodation_adjusted) || 0;
      const nightsCount = Number(r.nights_count) || 0;
      if (nightsCount === 0) return;
      
      const revenuePerNight = totalRevenue / nightsCount;
      
      let currentNight = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      
      while (currentNight < checkOut) {
        const nightYear = currentNight.getFullYear();
        const nightMonth = currentNight.getMonth(); // 0-11
        
        if (nightYear === year - 1) {
          baselineByMonth[nightMonth] = (baselineByMonth[nightMonth] || 0) + revenuePerNight;
          nightsByMonth[nightMonth] = (nightsByMonth[nightMonth] || 0) + 1;
        }
        
        currentNight.setDate(currentNight.getDate() + 1);
      }
    });

    const annualTotal = Object.values(baselineByMonth).reduce((sum, v) => sum + v, 0);
    const annualAverage = annualTotal / 12;

    console.log('Last year monthly baselines:', baselineByMonth);
    console.log(`Annual average: $${annualAverage.toFixed(0)}\n`);

    const today = new Date();
    const currentYear = year;
    const currentMonth = today.getMonth();
    const isFutureYear = currentYear > today.getFullYear();

    // Calculate revenue on books for the target year (night-based allocation)
    let revenueOnBooks = 0;
    reservations?.forEach(r => {
      if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
      
      const totalRevenue = Number(r.fare_accommodation_adjusted) || 0;
      const nightsCount = Number(r.nights_count) || 0;
      if (nightsCount === 0) return;
      
      const revenuePerNight = totalRevenue / nightsCount;
      let currentNight = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      
      while (currentNight < checkOut) {
        if (currentNight.getFullYear() === currentYear) {
          revenueOnBooks += revenuePerNight;
        }
        currentNight.setDate(currentNight.getDate() + 1);
      }
    });

    // Calculate past revenue (actual completed) using night-based allocation
    let pastRevenue = 0;
    if (!isFutureYear) {
      reservations?.forEach(r => {
        if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
        
        const totalRevenue = Number(r.fare_accommodation_adjusted) || 0;
        const nightsCount = Number(r.nights_count) || 0;
        if (nightsCount === 0) return;
        
        const revenuePerNight = totalRevenue / nightsCount;
        let currentNight = new Date(r.check_in);
        const checkOut = new Date(r.check_out);
        
        while (currentNight < checkOut) {
          const nightYear = currentNight.getFullYear();
          const nightMonth = currentNight.getMonth();
          
          if (nightYear === currentYear && nightMonth < currentMonth) {
            pastRevenue += revenuePerNight;
          }
          currentNight.setDate(currentNight.getDate() + 1);
        }
      });
    }

    const futureConfirmed = revenueOnBooks - pastRevenue;

    // Helper: Calculate Monthly RevPAR using night-based allocation
    function calculateMonthlyRevPAR(
      targetYear: number,
      targetMonth: number,
      asOfDate: Date,
      reservations: any[]
    ): { revpar: number; revenue: number; nights: number; bookingCount: number } {
      
      const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      
      let totalRevenue = 0;
      let totalNights = 0;
      const bookingIds = new Set();
      
      // Calculate revenue and nights for any night that falls in the target month
      reservations.forEach(r => {
        if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
        
        const created = new Date(r.created_at_guesty || r.check_in);
        if (created > asOfDate) return; // Only count bookings confirmed before asOfDate
        if (!['confirmed', 'checked_in', 'checked_out'].includes(r.status)) return;
        
        const totalResRevenue = Number(r.fare_accommodation_adjusted) || 0;
        const nightsCount = Number(r.nights_count) || 0;
        if (nightsCount === 0) return;
        
        const revenuePerNight = totalResRevenue / nightsCount;
        let currentNight = new Date(r.check_in);
        const checkOut = new Date(r.check_out);
        
        while (currentNight < checkOut) {
          const nightYear = currentNight.getFullYear();
          const nightMonth = currentNight.getMonth();
          
          if (nightYear === targetYear && nightMonth === targetMonth) {
            totalRevenue += revenuePerNight;
            totalNights += 1;
            bookingIds.add(r.id);
          }
          
          currentNight.setDate(currentNight.getDate() + 1);
        }
      });
      
      // RevPAR = Total Revenue / Calendar Days
      const revpar = totalRevenue / daysInMonth;
      
      return {
        revpar,
        revenue: totalRevenue,
        nights: totalNights,
        bookingCount: bookingIds.size
      };
    }

    // Helper: Calculate Velocity Factor
    function calculateVelocityFactor(
      targetYear: number,
      targetMonth: number,
      asOfDate: Date,
      reservations: any[]
    ): { 
      factor: number; 
      currentRevPAR: number; 
      lastYearRevPAR: number; 
      currentBookings: number;
      lastYearBookings: number;
      prorated: boolean;
    } {
      
      // Calculate same-day-last-year for true apples-to-apples comparison
      const lastYearAsOfDate = new Date(asOfDate);
      lastYearAsOfDate.setFullYear(lastYearAsOfDate.getFullYear() - 1);
      
      // Current year RevPAR (confirmed as of TODAY)
      const currentMetrics = calculateMonthlyRevPAR(
        targetYear, 
        targetMonth, 
        asOfDate, 
        reservations
      );
      
      // Last year RevPAR (confirmed as of SAME DAY LAST YEAR)
      const lastYearMetrics = calculateMonthlyRevPAR(
        targetYear - 1, 
        targetMonth, 
        lastYearAsOfDate, 
        reservations
      );
      
      let velocityFactor = 1.0;
      let prorated = false;
      
      // Calculate velocity based on RevPAR comparison
      if (lastYearMetrics.revpar > 0) {
        velocityFactor = currentMetrics.revpar / lastYearMetrics.revpar;
      } else if (currentMetrics.revpar > 0) {
        // No last year data but we have bookings this year = positive signal
        velocityFactor = 1.3;
        prorated = true;
      }
      
      // For far-future months with very few bookings, dampen extreme velocities
      const targetMonthStart = new Date(targetYear, targetMonth, 1);
      const daysUntilMonth = Math.ceil(
        (targetMonthStart.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysUntilMonth > 60 && currentMetrics.bookingCount < 2) {
        // Pull toward 1.0 for months far in future with sparse data
        velocityFactor = 0.7 + (velocityFactor * 0.3);
        prorated = true;
      }
      
      // Clip to reasonable bounds (0.5x to 2.0x)
      velocityFactor = Math.min(2.0, Math.max(0.5, velocityFactor));
      
      console.log(
        `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}: ` +
        `Current RevPAR=$${currentMetrics.revpar.toFixed(2)} ` +
        `(${currentMetrics.bookingCount} bookings, $${currentMetrics.revenue.toFixed(0)} revenue), ` +
        `Last Year RevPAR=$${lastYearMetrics.revpar.toFixed(2)} ` +
        `(${lastYearMetrics.bookingCount} bookings, $${lastYearMetrics.revenue.toFixed(0)} revenue), ` +
        `Velocity=${velocityFactor.toFixed(2)}x${prorated ? ' (prorated)' : ''}`
      );
      
      return {
        factor: velocityFactor,
        currentRevPAR: currentMetrics.revpar,
        lastYearRevPAR: lastYearMetrics.revpar,
        currentBookings: currentMetrics.bookingCount,
        lastYearBookings: lastYearMetrics.bookingCount,
        prorated
      };
    }

    // Main Forecast Function: Baseline × Velocity
    function forecastBaselineVelocity(
      targetYear: number,
      targetMonth: number,
      asOfDate: Date,
      baselineByMonth: Record<number, number>,
      annualAverage: number,
      reservations: any[]
    ): any {
      
      // Step 1: Get baseline from last year
      let baseline = baselineByMonth[targetMonth] || 0;
      
      if (baseline === 0) {
        baseline = annualAverage;
        console.log(`Month ${targetMonth + 1}: No baseline, using annual avg $${baseline.toFixed(0)}`);
      }
      
      // Step 2: Calculate velocity using same-store comparison
      const velocity = calculateVelocityFactor(
        targetYear, 
        targetMonth, 
        asOfDate, 
        reservations
      );
      
      // Step 3: Calculate revenue already on books for this month
      const onBooks = reservations
        .filter(r => {
          const checkIn = new Date(r.check_in);
          return checkIn.getFullYear() === targetYear &&
                 checkIn.getMonth() === targetMonth &&
                 ['confirmed', 'checked_in', 'checked_out'].includes(r.status);
        })
        .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0);
      
      // Step 4: Apply velocity to baseline
      const totalForecast = baseline * velocity.factor;
      const additionalNeeded = Math.max(0, totalForecast - onBooks);
      
      const yearMonth = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
      
      console.log(
        `${yearMonth} - Baseline: $${baseline.toFixed(0)}, ` +
        `Velocity: ${velocity.factor.toFixed(2)}x, ` +
        `Total Forecast: $${totalForecast.toFixed(0)} ` +
        `(On Books: $${onBooks.toFixed(0)}, Additional: $${additionalNeeded.toFixed(0)})`
      );
      
      return {
        month: yearMonth,
        baseline: baseline,
        velocity_factor: velocity.factor,
        current_revpar: velocity.currentRevPAR,
        last_year_revpar: velocity.lastYearRevPAR,
        current_bookings: velocity.currentBookings,
        last_year_bookings: velocity.lastYearBookings,
        revenue_on_books: onBooks,
        additional_forecast: additionalNeeded,
        total_forecast_p50: totalForecast,
        total_forecast_p25: totalForecast * 0.85,
        total_forecast_p75: totalForecast * 1.15
      };
    }

    // Simplified Monte Carlo Simulation
    function simulateForecast(
      monthlyForecasts: any[],
      simulationCount: number
    ): { p10: number; p25: number; p50: number; p75: number; p90: number } {
      
      const simulations: number[] = [];
      
      for (let i = 0; i < simulationCount; i++) {
        let simTotal = 0;
        
        for (const forecast of monthlyForecasts) {
          // Add random noise: velocity can vary ±20%
          const noise = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
          const simMonthForecast = forecast.baseline * forecast.velocity_factor * noise;
          
          // Take max of what's on books vs simulated forecast
          simTotal += Math.max(forecast.revenue_on_books, simMonthForecast);
        }
        
        simulations.push(simTotal);
      }
      
      simulations.sort((a, b) => a - b);
      
      return {
        p10: simulations[Math.floor(simulationCount * 0.1)],
        p25: simulations[Math.floor(simulationCount * 0.25)],
        p50: simulations[Math.floor(simulationCount * 0.5)],
        p75: simulations[Math.floor(simulationCount * 0.75)],
        p90: simulations[Math.floor(simulationCount * 0.9)]
      };
    }

    // Generate monthly forecasts
    const asOfDate = today;
    const monthlyForecasts: any[] = [];
    let totalOnBooks = 0;
    let totalAdditional = 0;
    let velocitySum = 0;

    console.log(`\n=== Forecasting ${year} (as of ${asOfDate.toISOString().split('T')[0]}) ===\n`);

    for (let month = 0; month < 12; month++) {
      const forecast = forecastBaselineVelocity(
        year,
        month,
        asOfDate,
        baselineByMonth,
        annualAverage,
        reservations || []
      );
      
      monthlyForecasts.push(forecast);
      totalOnBooks += forecast.revenue_on_books;
      totalAdditional += forecast.additional_forecast;
      velocitySum += forecast.velocity_factor;
    }

    const totalForecast = totalOnBooks + totalAdditional;
    const avgVelocity = velocitySum / 12;

    console.log(
      `\n=== Annual Summary ===` +
      `\nOn Books: $${totalOnBooks.toFixed(0)}` +
      `\nAdditional Needed: $${totalAdditional.toFixed(0)}` +
      `\nTotal Forecast: $${totalForecast.toFixed(0)}` +
      `\nAverage Velocity: ${avgVelocity.toFixed(2)}x\n`
    );

    // Run simulations
    const simResults = simulateForecast(monthlyForecasts, simulationCount);

    console.log(
      `Simulation Results (${simulationCount} runs):` +
      `\nP10: $${simResults.p10.toFixed(0)}` +
      `\nP25: $${simResults.p25.toFixed(0)}` +
      `\nP50: $${simResults.p50.toFixed(0)}` +
      `\nP75: $${simResults.p75.toFixed(0)}` +
      `\nP90: $${simResults.p90.toFixed(0)}\n`
    );

    // Calculate goal probabilities
    const totalBudget = goals?.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0) || 0;
    const totalProjection = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;
    const totalGoal = goals?.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0) || 0;

    const goalProbabilities = {
      budget: 0,
      projection: 0,
      goal: 0
    };

    if (goals && goals.length > 0) {
      // Run many simulations to calculate probabilities
      const simulations: number[] = [];
      for (let i = 0; i < simulationCount; i++) {
        let simTotal = 0;
        for (const forecast of monthlyForecasts) {
          const noise = 0.8 + (Math.random() * 0.4);
          const simForecast = forecast.baseline * forecast.velocity_factor * noise;
          simTotal += Math.max(forecast.revenue_on_books, simForecast);
        }
        simulations.push(simTotal);
      }
      
      goalProbabilities.budget = 
        (simulations.filter(s => s >= totalBudget).length / simulationCount) * 100;
      goalProbabilities.projection = 
        (simulations.filter(s => s >= totalProjection).length / simulationCount) * 100;
      goalProbabilities.goal = 
        (simulations.filter(s => s >= totalGoal).length / simulationCount) * 100;
      
      console.log(
        `Goal Probabilities:` +
        `\n  Budget ($${totalBudget.toFixed(0)}): ${goalProbabilities.budget.toFixed(1)}%` +
        `\n  Projection ($${totalProjection.toFixed(0)}): ${goalProbabilities.projection.toFixed(1)}%` +
        `\n  Goal ($${totalGoal.toFixed(0)}): ${goalProbabilities.goal.toFixed(1)}%\n`
      );
    }

    // Generate insights
    const insights = {
      drivers: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[]
    };

    // Overall velocity trend
    if (avgVelocity > 1.15) {
      insights.drivers.push(
        `Strong momentum - pacing ${((avgVelocity - 1) * 100).toFixed(0)}% ahead of last year`
      );
    }

    if (avgVelocity < 0.85) {
      insights.risks.push(
        `Slower pace - tracking ${((1 - avgVelocity) * 100).toFixed(0)}% behind last year`
      );
      insights.opportunities.push(
        'Consider promotional pricing or marketing push to accelerate bookings'
      );
    }

    // Identify best and worst performing months
    const sortedByVelocity = [...monthlyForecasts].sort((a, b) => 
      b.velocity_factor - a.velocity_factor
    );

    const strongestMonth = sortedByVelocity[0];
    const weakestMonth = sortedByVelocity[11];

    if (strongestMonth.velocity_factor > 1.3) {
      const bookingChange = strongestMonth.current_bookings - strongestMonth.last_year_bookings;
      
      let message = `${strongestMonth.month} outperforming with RevPAR of $${strongestMonth.current_revpar.toFixed(0)}/day ` +
        `(${strongestMonth.velocity_factor.toFixed(2)}x last year's $${strongestMonth.last_year_revpar.toFixed(0)})`;
      
      if (bookingChange > 0) {
        message += ` - driven by ${bookingChange} more bookings`;
      } else if (bookingChange < 0) {
        message += ` - higher rates offsetting ${Math.abs(bookingChange)} fewer bookings`;
      } else {
        message += ` - same booking volume with higher rates`;
      }
      
      insights.drivers.push(message);
    }

    if (weakestMonth.velocity_factor < 0.7) {
      const revparDrop = ((1 - weakestMonth.velocity_factor) * 100).toFixed(0);
      const bookingChange = weakestMonth.current_bookings - weakestMonth.last_year_bookings;
      
      let message = `${weakestMonth.month} underperforming with RevPAR of $${weakestMonth.current_revpar.toFixed(0)}/day ` +
        `(${revparDrop}% below last year's $${weakestMonth.last_year_revpar.toFixed(0)})`;
      
      if (bookingChange < 0) {
        message += ` - ${Math.abs(bookingChange)} fewer bookings`;
      } else if (bookingChange > 0) {
        message += ` - lower rates despite ${bookingChange} more bookings`;
      } else {
        message += ` - lower rates with same booking volume`;
      }
      
      insights.risks.push(message);
    }

    // Identify booking window opportunities
    const farFutureEmpty = monthlyForecasts.filter(f => {
      const monthStart = new Date(parseInt(f.month.split('-')[0]), 
                                   parseInt(f.month.split('-')[1]) - 1, 1);
      const daysUntil = (monthStart.getTime() - asOfDate.getTime()) / 
                        (1000 * 60 * 60 * 24);
      return daysUntil > 90 && f.current_bookings === 0;
    });

    if (farFutureEmpty.length > 2) {
      insights.opportunities.push(
        `${farFutureEmpty.length} months beyond 90 days have no bookings - ` +
        `opportunity to capture early planners`
      );
    }

    const forecastData = {
      listing_id: listingId,
      year,
      forecast_method: 'baseline_velocity',
      generated_at: today.toISOString(),
      
      // Summary
      revenue_on_books: totalOnBooks,
      forecasted_revenue: {
        p10: simResults.p10,
        p25: simResults.p25,
        p50: simResults.p50,
        p75: simResults.p75,
        p90: simResults.p90
      },
      total_forecast: {
        p10: simResults.p10,
        p25: simResults.p25,
        p50: simResults.p50,
        p75: simResults.p75,
        p90: simResults.p90
      },
      
      // Velocity metrics
      pace_factor: avgVelocity,
      
      // Monthly breakdown
      monthly_forecasts: monthlyForecasts,
      
      // Goals
      goal_probabilities: goalProbabilities,
      goal_targets: {
        budget: totalBudget,
        projection: totalProjection,
        goal: totalGoal
      },
      
      // Insights
      insights
    };

    // Save to database
    const { error: saveError } = await supabase
      .from('revenue_forecasts')
      .upsert({
        listing_id: listingId,
        year,
        forecast_method: 'baseline_velocity',
        pace_factor: avgVelocity,
        generated_at: today.toISOString(),
        revenue_on_books: totalOnBooks,
        forecasted_revenue: forecastData.forecasted_revenue,
        total_forecast: forecastData.total_forecast,
        goal_targets: forecastData.goal_targets,
        goal_probabilities: goalProbabilities,
        monthly_forecasts: monthlyForecasts,
        insights
      }, {
        onConflict: 'listing_id,year'
      });

    if (saveError) {
      console.error('Error saving forecast:', saveError);
    } else {
      console.log('RevPAR velocity forecast saved successfully');
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
