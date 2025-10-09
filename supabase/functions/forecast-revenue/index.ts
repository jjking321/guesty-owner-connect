import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ForecastSettings {
  forecast_method: 'additive' | 'multiplicative';
  dba_buckets: number[][];
  min_history_months: number;
  smoothing_window_months: number;
  pace_clip_min: number;
  pace_clip_max: number;
  simulation_runs: number;
  fallback_hierarchy: string[];
  owner_holds_treatment: string;
}

interface BookingCurve {
  listing_id: string;
  year_month: string;
  dba_bucket: string;
  pickup_share: number;
  pickup_amount_mean: number;
  pickup_amount_stddev: number;
  sample_size: number;
}

interface PaceFactor {
  factor: number;
  currentBookings: number;
  lastYearBookings: number;
  dbaToMonth: number;
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

    console.log(`Pace-aware forecasting for listing ${listingId}, year ${year}`);

    // Load forecast settings
    const { data: settings, error: settingsError } = await supabase
      .from('forecast_settings')
      .select('*')
      .limit(1)
      .single();

    const config: ForecastSettings = settings || {
      forecast_method: 'additive',
      dba_buckets: [[0,3],[4,7],[8,14],[15,30],[31,60],[61,90],[91,180],[181,365]],
      min_history_months: 24,
      smoothing_window_months: 3,
      pace_clip_min: 0.6,
      pace_clip_max: 1.4,
      simulation_runs: 10000,
      fallback_hierarchy: ['property', 'bedroom_cohort', 'portfolio'],
      owner_holds_treatment: 'exclude'
    };

    // Cap simulations at 1000 to prevent CPU timeout
    const simulationCount = Math.min(simulations || config.simulation_runs, 1000);

    // Fetch reservations (limit to 2 years and only needed columns)
    const { data: reservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('id, listing_id, check_in, check_out, fare_accommodation_adjusted, nights_count, status, created_at_guesty')
      .eq('listing_id', listingId)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', `${year - 2}-01-01`)
      .order('check_in', { ascending: true });

    if (reservationsError) throw reservationsError;

    // Fetch property goals
    const { data: goals, error: goalsError } = await supabase
      .from('property_goals')
      .select('*')
      .eq('listing_id', listingId)
      .eq('year', year);

    if (goalsError) throw goalsError;

    // Fetch booking curves
    const { data: bookingCurves, error: curvesError } = await supabase
      .from('booking_curves')
      .select('*')
      .eq('listing_id', listingId);

    if (curvesError) console.error('Error loading booking curves:', curvesError);

    // Fetch capacity calendar (next 365 days)
    const today = new Date();
    const endCapacity = new Date();
    endCapacity.setDate(endCapacity.getDate() + 365);

    const { data: capacityData, error: capacityError } = await supabase
      .from('capacity_calendar')
      .select('*')
      .eq('listing_id', listingId)
      .gte('date', today.toISOString().split('T')[0])
      .lte('date', endCapacity.toISOString().split('T')[0]);

    if (capacityError) console.error('Error loading capacity:', capacityError);

    const currentYear = year;
    const currentMonth = today.getMonth();
    const isFutureYear = currentYear > today.getFullYear();

    // Calculate revenue on books
    const revenueOnBooks = reservations
      ?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === currentYear && r.fare_accommodation_adjusted;
      })
      .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

    // Calculate past revenue (actual completed)
    const pastRevenue = isFutureYear ? 0 : reservations
      ?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === currentYear && 
               checkIn.getMonth() < currentMonth &&
               r.fare_accommodation_adjusted;
      })
      .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

    const futureConfirmed = revenueOnBooks - pastRevenue;

    // Helper: Compute pace factor for a month
    function computePaceFactor(targetMonth: Date, asOfDate: Date): PaceFactor {
      const dba = Math.floor((targetMonth.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24));
      const month = targetMonth.getMonth();
      const targetYear = targetMonth.getFullYear();

      const lastYearSameDay = new Date(asOfDate);
      lastYearSameDay.setFullYear(lastYearSameDay.getFullYear() - 1);

      const lastYearBookings = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        const created = new Date(r.created_at_guesty || r.check_in);
        return checkIn.getFullYear() === targetYear - 1 &&
               checkIn.getMonth() === month &&
               created <= lastYearSameDay;
      }).length || 0;

      const currentBookings = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        const created = new Date(r.created_at_guesty || r.check_in);
        return checkIn.getFullYear() === targetYear &&
               checkIn.getMonth() === month &&
               created <= asOfDate;
      }).length || 0;

      let paceFactor = lastYearBookings > 0 ? currentBookings / lastYearBookings : 1.0;
      
      // Clip to configured range
      paceFactor = Math.min(config.pace_clip_max, Math.max(config.pace_clip_min, paceFactor));

      return {
        factor: paceFactor,
        currentBookings,
        lastYearBookings,
        dbaToMonth: dba
      };
    }

    // Helper: Calculate historical ADR
    function calculateHistoricalADR(yearMonth: string): number {
      const [y, m] = yearMonth.split('-').map(Number);
      const relevantRes = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === y && checkIn.getMonth() === m - 1;
      }) || [];

      if (relevantRes.length === 0) return 150; // Fallback ADR

      const totalRev = relevantRes.reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0);
      const totalNights = relevantRes.reduce((sum, r) => sum + (Number(r.nights_count) || 0), 0);

      return totalNights > 0 ? totalRev / totalNights : 150;
    }

    // Helper: Get capacity for a month
    function getMonthCapacity(yearMonth: string): number {
      const [y, m] = yearMonth.split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);

      if (!capacityData || capacityData.length === 0) {
        // Fallback: assume 30 days available
        return 30;
      }

      const availableNights = capacityData.filter(d => {
        const date = new Date(d.date);
        return date >= monthStart && date <= monthEnd && d.is_available;
      }).length;

      return availableNights;
    }

    // Helper: Normal distribution sampling
    function normalSample(mean: number, stdDev: number): number {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // Deterministic Forecast (Additive Method)
    function forecastDeterministicAdditive(targetYearMonth: string, asOfDate: Date): any {
      const [y, m] = targetYearMonth.split('-').map(Number);
      const targetMonth = new Date(y, m - 1, 15);
      const currentDBA = Math.floor((targetMonth.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24));

      // Revenue already on books for this month
      const onBooks = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === y && 
               checkIn.getMonth() === m - 1 &&
               ['confirmed', 'checked_in'].includes(r.status);
      }).reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

      // Get booking curves for this month (or similar months)
      const curves = bookingCurves?.filter(c => c.listing_id === listingId) || [];
      
      let expectedRemaining = 0;

      // Sum up expected pickup from future DBA buckets
      for (const bucketDef of config.dba_buckets) {
        const bucketStart = bucketDef[0];
        const bucketEnd = bucketDef[1];
        const bucketLabel = bucketEnd >= 365 ? `${bucketStart}+` : `${bucketStart}-${bucketEnd}`;

        // Only include buckets we haven't passed yet
        if (currentDBA <= bucketEnd || bucketEnd >= 365) {
          // Try exact year-month match first
          let curve = curves.find(c => 
            c.year_month === targetYearMonth &&
            c.dba_bucket === bucketLabel &&
            c.sample_size >= 2
          );

          // FALLBACK: If no exact match, use same calendar month from previous year(s)
          if (!curve) {
            const [targetYear, targetMonthStr] = targetYearMonth.split('-');
            const calendarMonth = targetMonthStr; // e.g., '04' for April
            
            // Find all curves for this calendar month from previous years
            const historicalCurves = curves.filter(c => {
              const [curveYear, curveMonth] = (c.year_month || '').split('-');
              return curveMonth === calendarMonth &&
                     c.dba_bucket === bucketLabel &&
                     c.sample_size >= 2 &&
                     parseInt(curveYear) < parseInt(targetYear);
            });

            if (historicalCurves.length > 0) {
              // Average the pickup_amount_mean across historical years
              const avgPickup = historicalCurves.reduce((sum, c) => 
                sum + (Number(c.pickup_amount_mean) || 0), 0) / historicalCurves.length;
              
              const avgStddev = historicalCurves.reduce((sum, c) => 
                sum + (Number(c.pickup_amount_stddev) || 0), 0) / historicalCurves.length;
              
              // Create a synthetic curve based on historical average
              curve = {
                pickup_amount_mean: avgPickup,
                pickup_amount_stddev: avgStddev,
                sample_size: Math.min(...historicalCurves.map(c => c.sample_size)),
                listing_id: listingId,
                year_month: targetYearMonth,
                dba_bucket: bucketLabel
              };
              
              console.log(`Historical fallback for ${targetYearMonth} bucket ${bucketLabel}: avg $${avgPickup.toFixed(0)} from ${historicalCurves.length} year(s)`);
            }
          }

          if (curve) {
            expectedRemaining += Number(curve.pickup_amount_mean) || 0;
          }
        }
      }

      // Apply pace factor
      const paceData = computePaceFactor(targetMonth, asOfDate);
      const paceAdjustedRemaining = expectedRemaining * paceData.factor;
      
      console.log(`${targetYearMonth} - Base: $${expectedRemaining.toFixed(0)}, Pace: ${paceData.factor.toFixed(2)}, Adjusted: $${paceAdjustedRemaining.toFixed(0)}`);

      // Capacity constraint
      const openNights = getMonthCapacity(targetYearMonth);
      const bookedNights = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === y && checkIn.getMonth() === m - 1;
      }).reduce((sum, r) => sum + (Number(r.nights_count) || 0), 0) || 0;

      const remainingCapacity = Math.max(0, openNights - bookedNights);
      const historicalADR = calculateHistoricalADR(targetYearMonth);
      const impliedAdditionalNights = paceAdjustedRemaining / historicalADR;

      let capacityScaler = 1.0;
      let capacityConstrained = false;

      if (impliedAdditionalNights > remainingCapacity) {
        capacityScaler = remainingCapacity / impliedAdditionalNights;
        capacityConstrained = true;
      }

      const finalRemainingPickup = paceAdjustedRemaining * capacityScaler;
      const forecast = onBooks + finalRemainingPickup;

      return {
        yearMonth: targetYearMonth,
        onBooks,
        remainingPickup: finalRemainingPickup,
        paceFactor: paceData.factor,
        capacityScaler,
        forecast,
        capacityConstrained,
        capacityUtilization: openNights > 0 ? (bookedNights / openNights) * 100 : 0
      };
    }

    // Simplified Monte Carlo Simulation (optimized for performance)
    function simulateForecast(targetYearMonth: string, asOfDate: Date, runs: number): any {
      const [y, m] = targetYearMonth.split('-').map(Number);
      const targetMonth = new Date(y, m - 1, 15);

      const onBooks = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === y && 
               checkIn.getMonth() === m - 1 &&
               ['confirmed', 'checked_in'].includes(r.status);
      }).reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

      const paceData = computePaceFactor(targetMonth, asOfDate);
      
      // Use deterministic forecast as baseline
      const deterministic = forecastDeterministicAdditive(targetYearMonth, asOfDate);
      const baseForecast = deterministic.forecast;
      
      // Simple simulation with reduced complexity
      const results: number[] = [];
      const stdDev = baseForecast * 0.15; // 15% standard deviation
      
      for (let i = 0; i < runs; i++) {
        const sample = normalSample(baseForecast, stdDev);
        results.push(Math.max(onBooks, sample));
      }

      results.sort((a, b) => a - b);

      return {
        p10: results[Math.floor(runs * 0.10)],
        p25: results[Math.floor(runs * 0.25)],
        p50: results[Math.floor(runs * 0.50)],
        p75: results[Math.floor(runs * 0.75)],
        p90: results[Math.floor(runs * 0.90)],
        mean: results.reduce((a, b) => a + b, 0) / runs
      };
    }

    // Generate monthly forecasts
    const monthlyForecasts = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dbaBreakdown: any = {};

    let totalForecastP50 = 0;

    for (let month = 0; month < 12; month++) {
      const isPastMonth = !isFutureYear && month < currentMonth;
      const yearMonth = `${currentYear}-${String(month + 1).padStart(2, '0')}`;

      const actualRevenue = reservations?.filter(r => {
        const checkIn = new Date(r.check_in);
        return checkIn.getFullYear() === currentYear && 
               checkIn.getMonth() === month;
      }).reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0) || 0;

      if (isPastMonth) {
        monthlyForecasts.push({
          month,
          monthName: monthNames[month],
          yearMonth,
          isPast: true,
          actualRevenue,
          revenueOnBooks: actualRevenue,
          forecast: { p50: actualRevenue, p10: actualRevenue, p90: actualRevenue }
        });
        totalForecastP50 += actualRevenue;
      } else {
        const deterministic = forecastDeterministicAdditive(yearMonth, today);
        const simulated = simulateForecast(yearMonth, today, simulationCount);

        monthlyForecasts.push({
          month,
          monthName: monthNames[month],
          yearMonth,
          isPast: false,
          actualRevenue: 0,
          revenueOnBooks: deterministic.onBooks,
          remainingPickup: deterministic.remainingPickup,
          paceFactor: deterministic.paceFactor,
          capacityUtilization: deterministic.capacityUtilization,
          capacityConstrained: deterministic.capacityConstrained,
          forecast: {
            p50: simulated.p50,
            p10: simulated.p10,
            p90: simulated.p90
          }
        });

        dbaBreakdown[yearMonth] = {
          onBooks: deterministic.onBooks,
          paceFactor: deterministic.paceFactor,
          capacityUtilization: deterministic.capacityUtilization
        };

        totalForecastP50 += simulated.p50;
      }
    }

    // Calculate goal probabilities using totalForecastP50
    const totalBudget = goals?.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0) || 0;
    const totalProjection = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;
    const totalGoal = goals?.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0) || 0;

    // Simplified goal probability calculation using forecast variance
    const forecastStdDev = totalForecastP50 * 0.15;
    const yearSimResults: number[] = [];
    
    // Reduced simulations for year total
    for (let sim = 0; sim < Math.min(simulationCount, 500); sim++) {
      const yearTotal = normalSample(totalForecastP50, forecastStdDev);
      yearSimResults.push(Math.max(pastRevenue, yearTotal));
    }

    yearSimResults.sort((a, b) => a - b);

    const goalProbabilities = {
      budget: totalBudget > 0 ? (yearSimResults.filter(s => s >= totalBudget).length / yearSimResults.length) * 100 : 0,
      projection: totalProjection > 0 ? (yearSimResults.filter(s => s >= totalProjection).length / yearSimResults.length) * 100 : 0,
      goal: totalGoal > 0 ? (yearSimResults.filter(s => s >= totalGoal).length / yearSimResults.length) * 100 : 0
    };

    console.log(`Goal probabilities calculated from ${yearSimResults.length} simulations:`, {
      budget: goalProbabilities.budget,
      projection: goalProbabilities.projection,
      goal: goalProbabilities.goal,
      totalForecastP50,
      targets: { totalBudget, totalProjection, totalGoal }
    });

    // Generate insights
    const avgPace = monthlyForecasts
      .filter(m => !m.isPast && m.paceFactor)
      .reduce((sum, m) => sum + m.paceFactor, 0) / monthlyForecasts.filter(m => !m.isPast && m.paceFactor).length;

    const insights = {
      keyDrivers: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[]
    };

    if (avgPace > 1.1) {
      insights.keyDrivers.push(`Strong booking pace: ${((avgPace - 1) * 100).toFixed(0)}% ahead of last year`);
    } else if (avgPace < 0.9) {
      insights.risks.push(`Booking pace ${((1 - avgPace) * 100).toFixed(0)}% behind last year`);
    }

    const constrained = monthlyForecasts.filter(m => m.capacityConstrained).length;
    if (constrained > 0) {
      insights.keyDrivers.push(`${constrained} month(s) capacity-constrained - optimize pricing`);
    }

    if (goalProbabilities.goal < 30) {
      insights.risks.push('Low probability of hitting year-end goal');
    }

    const forecastData = {
      listingId,
      year,
      asOfDate: today.toISOString(),
      forecastMethod: config.forecast_method,
      pastRevenue,
      futureConfirmed,
      revenueOnBooks,
      forecastedRevenue: {
        p10: yearSimResults[Math.floor(simulationCount * 0.1)],
        p50: totalForecastP50,
        p90: yearSimResults[Math.floor(simulationCount * 0.9)]
      },
      totalForecast: {
        p50: totalForecastP50,
        confidence: {
          lower: yearSimResults[Math.floor(simulationCount * 0.1)],
          upper: yearSimResults[Math.floor(simulationCount * 0.9)]
        }
      },
      goalTargets: {
        budget: totalBudget,
        projection: totalProjection,
        goal: totalGoal
      },
      goalProbabilities,
      monthlyForecasts,
      dbaBreakdown,
      insights
    };

    // Save to database
    const { error: saveError } = await supabase
      .from('revenue_forecasts')
      .upsert({
        listing_id: listingId,
        year,
        forecast_method: config.forecast_method,
        pace_factor: avgPace,
        capacity_utilization: monthlyForecasts
          .filter(m => !m.isPast && m.capacityUtilization)
          .reduce((sum, m) => sum + m.capacityUtilization, 0) / monthlyForecasts.filter(m => !m.isPast && m.capacityUtilization).length,
        dba_breakdown: dbaBreakdown,
        generated_at: today.toISOString(),
        revenue_on_books: revenueOnBooks,
        forecasted_revenue: forecastData.forecastedRevenue,
        total_forecast: forecastData.totalForecast,
        goal_targets: forecastData.goalTargets,
        goal_probabilities: goalProbabilities,
        monthly_forecasts: monthlyForecasts,
        insights
      }, {
        onConflict: 'listing_id,year'
      });

    if (saveError) {
      console.error('Error saving forecast:', saveError);
    } else {
      console.log('Pace-aware forecast saved');
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
