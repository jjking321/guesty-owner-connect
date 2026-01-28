import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ForecastSettings {
  simulation_runs: number;
}

interface BookingProbability {
  date: string;
  probability: number;
  your_price: number | null;
  current_dba: number | null;
  compset_demand_score: number | null;
  avg_available_rate: number | null;
}

interface CompsetSummary {
  future_monthly_averages: Array<{
    month: string;
    avg_rate: number | null;
    occupancy_rate: number | null;
    revpar: number | null;
    booked_count: number;
    total_count: number;
  }> | null;
  monthly_averages: Array<{
    month: string;
    revenue?: number;
    avg_revenue?: number;
    adr?: number;
    avg_rate?: number;
    occupancy?: number;
    occupancy_rate?: number;
  }> | null;
  avg_ttm_revenue: number | null;
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

    console.log(`\n=== Enhanced RevPAR Velocity + Probability Forecast for listing ${listingId}, year ${year} ===\n`);

    // Load forecast settings
    const { data: settings } = await supabase
      .from('forecast_settings')
      .select('simulation_runs')
      .limit(1)
      .maybeSingle();

    const simulationCount = Math.min(simulations || settings?.simulation_runs || 1000, 1000);

    // Fetch ALL reservations (we need historical data for baseline and floor calculations)
    // Exclude owner reservations from calculations
    const { data: reservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('id, listing_id, check_in, check_out, fare_accommodation_adjusted, nights_count, status, created_at_guesty')
      .eq('listing_id', listingId)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .neq('source', 'owner')
      .gte('check_in', `${year - 3}-01-01`)
      .order('check_in', { ascending: true });

    if (reservationsError) throw reservationsError;

    // Fetch property goals
    const { data: goals } = await supabase
      .from('property_goals')
      .select('*')
      .eq('listing_id', listingId)
      .eq('year', year);

    // Fetch booking probabilities for future dates
    const today = new Date();
    const { data: bookingProbabilities, error: probError } = await supabase
      .from('booking_probabilities')
      .select('date, probability, your_price, current_dba, compset_demand_score, avg_available_rate')
      .eq('listing_id', listingId)
      .gte('date', today.toISOString().split('T')[0])
      .lte('date', `${year}-12-31`);

    if (probError) {
      console.log('Warning: Could not fetch booking probabilities:', probError.message);
    }

    // Fetch compset summary for demand signals AND historical monthly averages
    const { data: compsetSummary, error: compsetError } = await supabase
      .from('property_compset_summary')
      .select('future_monthly_averages, monthly_averages, avg_ttm_revenue')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (compsetError) {
      console.log('Warning: Could not fetch compset summary:', compsetError.message);
    }

    // Build lookup maps for probability data
    const probabilityByDate = new Map<string, BookingProbability>();
    if (bookingProbabilities) {
      bookingProbabilities.forEach(bp => {
        probabilityByDate.set(bp.date, bp);
      });
    }

    // Build compset demand lookup by month
    const compsetDemandByMonth = new Map<string, { occupancyRate: number; demandSignal: string; bookedCount: number; totalCount: number }>();
    if (compsetSummary?.future_monthly_averages) {
      (compsetSummary.future_monthly_averages as any[]).forEach((avg) => {
        const monthKey: string | undefined = avg.month ?? avg.year_month ?? avg.yearMonth;

        let occupancyRate: number = avg.occupancy_rate ?? avg.occupancy ?? 0;
        if (typeof occupancyRate === 'string') occupancyRate = Number(occupancyRate);
        if (!Number.isFinite(occupancyRate)) occupancyRate = 0;

        // Normalize to 0..1 (some sources may provide 0..100)
        if (occupancyRate > 1) occupancyRate = occupancyRate / 100;

        let demandSignal = 'Medium';
        if (occupancyRate >= 0.70) demandSignal = 'High';
        else if (occupancyRate < 0.30) demandSignal = 'Low';

        if (!monthKey) return;

        compsetDemandByMonth.set(monthKey, {
          occupancyRate,
          demandSignal,
          bookedCount: avg.booked_count ?? avg.bookedCount ?? 0,
          totalCount: avg.total_count ?? avg.totalCount ?? 0,
        });
      });
    }

    console.log(`Loaded ${probabilityByDate.size} booking probabilities and ${compsetDemandByMonth.size} compset demand signals`);

    // Build baseline from last year's actual monthly revenue
    const baselineByMonth: Record<number, number> = {};
    const nightsByMonth: Record<number, number> = {};

    // Also track prior year and prior-prior year actuals for floor calculation
    let priorYearActual = 0;      // year - 1 total (e.g., 2025 for 2026 forecast)
    let priorPriorYearActual = 0; // year - 2 total (e.g., 2024 for 2026 forecast)

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
          priorYearActual += revenuePerNight;
        }
        
        if (nightYear === year - 2) {
          priorPriorYearActual += revenuePerNight;
        }
        
        currentNight.setDate(currentNight.getDate() + 1);
      }
    });

    // Count months with prior year data for cold start detection
    const monthsWithPriorData = Object.keys(baselineByMonth).length;
    const isColdStart = monthsWithPriorData < 6;
    
    // Build compset monthly averages lookup for cold start properties
    const compsetMonthlyRevenue: Record<number, number> = {};
    let compsetTTMRevenue = compsetSummary?.avg_ttm_revenue || 0;
    
    if (isColdStart && compsetSummary?.monthly_averages) {
      console.log(`\n⚠️ COLD START DETECTED: Only ${monthsWithPriorData} months of prior year data. Using compset baseline.\n`);
      
      const monthlyAvgs = compsetSummary.monthly_averages as any[];
      
      // Get the most recent 12 months of compset data
      const sortedMonths = monthlyAvgs
        .filter(m => m.month || m.year_month || m.yearMonth)
        .sort((a, b) => {
          const monthA = a.month || a.year_month || a.yearMonth;
          const monthB = b.month || b.year_month || b.yearMonth;
          return monthB.localeCompare(monthA); // descending
        })
        .slice(0, 24); // Get last 24 months to ensure we have coverage
      
      // Build lookup by month number (0-11)
      sortedMonths.forEach(entry => {
        const monthKey = entry.month || entry.year_month || entry.yearMonth;
        if (!monthKey) return;
        
        // Extract month number from YYYY-MM format
        const monthNum = parseInt(monthKey.split('-')[1], 10) - 1; // Convert to 0-11
        
        // Try multiple field names for revenue
        const revenue = entry.revenue || entry.avg_revenue || 
                       (entry.revpar && entry.occupancy ? entry.revpar * 30 : null) ||
                       (entry.adr || entry.avg_rate || 0) * ((entry.occupancy || entry.occupancy_rate || 0.5) * 30);
        
        if (revenue && !compsetMonthlyRevenue[monthNum]) {
          compsetMonthlyRevenue[monthNum] = revenue;
        }
      });
      
      // Calculate compset TTM from monthly averages if not available
      if (!compsetTTMRevenue && Object.keys(compsetMonthlyRevenue).length >= 6) {
        compsetTTMRevenue = Object.values(compsetMonthlyRevenue).reduce((sum, v) => sum + v, 0);
      }
      
      console.log('Compset monthly revenue lookup:', compsetMonthlyRevenue);
      console.log(`Compset TTM Revenue: $${compsetTTMRevenue.toFixed(0)}`);
    }

    // Apply cold start baseline: use compset averages with 0.85x discount for new properties
    const COLD_START_DISCOUNT = 0.85;
    
    if (isColdStart && Object.keys(compsetMonthlyRevenue).length > 0) {
      for (let month = 0; month < 12; month++) {
        if (!baselineByMonth[month] && compsetMonthlyRevenue[month]) {
          baselineByMonth[month] = compsetMonthlyRevenue[month] * COLD_START_DISCOUNT;
          console.log(`Month ${month + 1}: Using compset baseline $${compsetMonthlyRevenue[month].toFixed(0)} * ${COLD_START_DISCOUNT} = $${baselineByMonth[month].toFixed(0)}`);
        }
      }
    }

    const annualTotal = Object.values(baselineByMonth).reduce((sum, v) => sum + v, 0);
    const annualAverage = annualTotal / 12;

    // Calculate YoY growth rate from last two complete years
    const yoyGrowthRate = priorPriorYearActual > 0 
      ? priorYearActual / priorPriorYearActual 
      : 1.0;

    // Forecast floor calculation
    let forecastFloor: number;
    
    if (isColdStart && compsetTTMRevenue > 0) {
      // For cold start properties: floor = compset TTM * 0.80
      // This accounts for new property ramp-up while preventing unrealistic lows
      forecastFloor = compsetTTMRevenue * 0.80;
      console.log(`Cold start forecast floor: Compset TTM $${compsetTTMRevenue.toFixed(0)} * 0.80 = $${forecastFloor.toFixed(0)}`);
    } else {
      // Standard calculation: prior year actual * capped growth trend (between 0.95x and 1.10x)
      const cappedGrowthRate = Math.max(0.95, Math.min(yoyGrowthRate, 1.10));
      forecastFloor = priorYearActual * cappedGrowthRate;
      console.log(`Forecast floor: Prior year $${priorYearActual.toFixed(0)} * ${cappedGrowthRate.toFixed(2)} = $${forecastFloor.toFixed(0)}`);
    }

    console.log('\nLast year monthly baselines:', baselineByMonth);
    console.log(`Annual baseline total: $${annualTotal.toFixed(0)}, Monthly average: $${annualAverage.toFixed(0)}`);
    console.log(`Prior year (${year - 1}) actual: $${priorYearActual.toFixed(0)}`);
    console.log(`Prior-prior year (${year - 2}) actual: $${priorPriorYearActual.toFixed(0)}`);
    console.log(`YoY growth rate: ${yoyGrowthRate.toFixed(2)}x`);
    console.log(`Cold start mode: ${isColdStart ? 'YES' : 'NO'}\n`);

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
      
      // Calculate how many months until the target month
      const targetMonthStart = new Date(targetYear, targetMonth, 1);
      const monthsUntilTarget = (targetYear - asOfDate.getFullYear()) * 12 + 
                                (targetMonth - asOfDate.getMonth());
      
      // For months more than 12 months in the future, velocity comparison is unreliable
      // because booking data is naturally sparse that far out
      if (monthsUntilTarget > 12) {
        // Use baseline (velocity = 1.0) for far-future months
        // Don't penalize for sparse booking data
        velocityFactor = 1.0;
        prorated = true;
        console.log(`  → Far future month (${monthsUntilTarget}mo out), using baseline velocity of 1.0`);
      } else {
        // Calculate velocity based on RevPAR comparison for near-term months
        if (lastYearMetrics.revpar > 0) {
          velocityFactor = currentMetrics.revpar / lastYearMetrics.revpar;
        } else if (currentMetrics.revpar > 0) {
          // No last year data but we have bookings this year = positive signal
          velocityFactor = 1.3;
          prorated = true;
        }
        
        // For months 2-12 months out with very few bookings, dampen extreme velocities
        const daysUntilMonth = Math.ceil(
          (targetMonthStart.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (daysUntilMonth > 60 && currentMetrics.bookingCount < 2) {
          // Pull toward 1.0 for months far in future with sparse data
          velocityFactor = 0.7 + (velocityFactor * 0.3);
          prorated = true;
        }
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

    // NEW: Calculate probability-weighted expected value for a month
    function calculateProbabilityExpectedValue(
      targetYear: number,
      targetMonth: number,
      probabilityByDate: Map<string, BookingProbability>,
      bookedDates: Set<string>
    ): { expectedValue: number; openNights: number; avgProbability: number; avgPrice: number } {
      const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      
      let totalExpectedValue = 0;
      let openNights = 0;
      let totalProbability = 0;
      let totalPrice = 0;
      let priceCount = 0;
      
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // Skip if already booked
        if (bookedDates.has(dateStr)) continue;
        
        const probData = probabilityByDate.get(dateStr);
        if (probData && probData.probability !== null && probData.your_price !== null) {
          const probability = probData.probability / 100; // Convert to decimal
          const price = probData.your_price;
          
          totalExpectedValue += price * probability;
          openNights++;
          totalProbability += probData.probability;
          totalPrice += price;
          priceCount++;
        }
      }
      
      return {
        expectedValue: totalExpectedValue,
        openNights,
        avgProbability: openNights > 0 ? totalProbability / openNights : 0,
        avgPrice: priceCount > 0 ? totalPrice / priceCount : 0
      };
    }

    // Build set of booked dates for the target year
    const bookedDates = new Set<string>();
    reservations?.forEach(r => {
      if (!r.check_in || !r.check_out) return;
      if (!['confirmed', 'checked_in', 'checked_out'].includes(r.status)) return;
      
      let currentNight = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      
      while (currentNight < checkOut) {
        if (currentNight.getFullYear() === year) {
          bookedDates.add(currentNight.toISOString().split('T')[0]);
        }
        currentNight.setDate(currentNight.getDate() + 1);
      }
    });

    // Main Forecast Function: Baseline × Velocity + Probability Blending
    function forecastEnhanced(
      targetYear: number,
      targetMonth: number,
      asOfDate: Date,
      baselineByMonth: Record<number, number>,
      annualAverage: number,
      reservations: any[],
      probabilityByDate: Map<string, BookingProbability>,
      bookedDates: Set<string>,
      compsetDemandByMonth: Map<string, { occupancyRate: number; demandSignal: string; bookedCount: number; totalCount: number }>
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
      
      // Step 3: Calculate revenue already on books for this month using night-based allocation
      let onBooks = 0;
      reservations.forEach(r => {
        if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
        if (!['confirmed', 'checked_in', 'checked_out'].includes(r.status)) return;
        
        const totalRevenue = Number(r.fare_accommodation_adjusted) || 0;
        const nightsCount = Number(r.nights_count) || 0;
        if (nightsCount === 0) return;
        
        const revenuePerNight = totalRevenue / nightsCount;
        const checkIn = new Date(r.check_in);
        const checkOut = new Date(r.check_out);
        
        // Iterate through each night and allocate revenue to the correct month
        let currentNight = new Date(checkIn);
        while (currentNight < checkOut) {
          if (currentNight.getFullYear() === targetYear && currentNight.getMonth() === targetMonth) {
            onBooks += revenuePerNight;
          }
          currentNight.setDate(currentNight.getDate() + 1);
        }
      });
      
      // Step 4: Calculate velocity-based forecast (existing approach)
      const velocityForecast = baseline * velocity.factor;
      
      // Step 5: Calculate probability-weighted expected value (new approach)
      const probExpected = calculateProbabilityExpectedValue(
        targetYear,
        targetMonth,
        probabilityByDate,
        bookedDates
      );
      
      // Probability forecast = On books + Expected value from open nights
      const probabilityForecast = onBooks + probExpected.expectedValue;
      
      // Step 6: Determine blending weights based on time horizon
      const monthStart = new Date(targetYear, targetMonth, 1);
      const daysUntilMonth = Math.ceil(
        (monthStart.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      let velocityWeight: number;
      let probabilityWeight: number;
      let forecastConfidence: string;
      
      // Blend based on data quality and time horizon
      const hasProbabilityData = probExpected.openNights > 0 && probExpected.avgProbability > 0;
      
      if (daysUntilMonth <= 0) {
        // Past month - use actual (velocity = 1, prob = 0)
        velocityWeight = 1.0;
        probabilityWeight = 0.0;
        forecastConfidence = 'actual';
      } else if (daysUntilMonth <= 30 && hasProbabilityData) {
        // Close-in with good probability data
        velocityWeight = 0.30;
        probabilityWeight = 0.70;
        forecastConfidence = 'high';
      } else if (daysUntilMonth <= 90 && hasProbabilityData) {
        // Standard range with probability data
        velocityWeight = 0.50;
        probabilityWeight = 0.50;
        forecastConfidence = 'medium';
      } else if (daysUntilMonth <= 90) {
        // Standard range without probability data
        velocityWeight = 0.80;
        probabilityWeight = 0.20;
        forecastConfidence = 'medium';
      } else {
        // Far-out - lean heavily on velocity
        velocityWeight = 0.85;
        probabilityWeight = 0.15;
        forecastConfidence = 'low';
      }
      
      // Calculate blended forecast
      let blendedForecast: number;
      if (hasProbabilityData && probabilityWeight > 0) {
        blendedForecast = (velocityForecast * velocityWeight) + (probabilityForecast * probabilityWeight);
      } else {
        blendedForecast = velocityForecast;
      }
      
      // Ensure blended forecast is at least what's on books
      blendedForecast = Math.max(blendedForecast, onBooks);
      
      const additionalNeeded = Math.max(0, blendedForecast - onBooks);
      
      // Step 7: Get compset demand signal for this month
      const yearMonth = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
      const compsetDemand = compsetDemandByMonth.get(yearMonth);
      
      console.log(
        `${yearMonth} - ` +
        `Velocity Forecast: $${velocityForecast.toFixed(0)}, ` +
        `Probability Forecast: $${probabilityForecast.toFixed(0)} ` +
        `(${probExpected.openNights} open nights @ ${probExpected.avgProbability.toFixed(0)}% avg prob), ` +
        `Blended: $${blendedForecast.toFixed(0)} ` +
        `(${(velocityWeight * 100).toFixed(0)}%V/${(probabilityWeight * 100).toFixed(0)}%P), ` +
        `Compset: ${compsetDemand?.demandSignal || 'N/A'}`
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
        
        // NEW: Enhanced forecast data
        velocity_forecast: velocityForecast,
        probability_forecast: probabilityForecast,
        blended_forecast: blendedForecast,
        open_nights: probExpected.openNights,
        avg_open_probability: probExpected.avgProbability,
        avg_open_price: probExpected.avgPrice,
        expected_additional: probExpected.expectedValue,
        velocity_weight: velocityWeight,
        probability_weight: probabilityWeight,
        forecast_confidence: forecastConfidence,
        compset_demand: compsetDemand?.demandSignal || null,
        compset_occupancy: compsetDemand?.occupancyRate || null,
        
        // Backwards compatible fields
        additional_forecast: additionalNeeded,
        total_forecast_p50: blendedForecast,
        total_forecast_p25: blendedForecast * 0.85,
        total_forecast_p75: blendedForecast * 1.15
      };
    }

    // Monte Carlo Simulation with data-driven variance
    function simulateForecastEnhanced(
      monthlyForecasts: any[],
      simulationCount: number,
      forecastFloor: number
    ): { p10: number; p25: number; p50: number; p75: number; p90: number } {
      
      const simulations: number[] = [];
      
      for (let i = 0; i < simulationCount; i++) {
        let simTotal = 0;
        
        for (const forecast of monthlyForecasts) {
          // Data-driven variance based on forecast confidence
          let varianceRange: number;
          switch (forecast.forecast_confidence) {
            case 'high':
              varianceRange = 0.10; // ±10%
              break;
            case 'medium':
              varianceRange = 0.20; // ±20%
              break;
            case 'low':
              varianceRange = 0.30; // ±30%
              break;
            default:
              varianceRange = 0.05; // ±5% for actual
          }
          
          const noise = (1 - varianceRange) + (Math.random() * varianceRange * 2);
          const simMonthForecast = forecast.blended_forecast * noise;
          
          // Take max of what's on books vs simulated forecast
          simTotal += Math.max(forecast.revenue_on_books, simMonthForecast);
        }
        
        simulations.push(simTotal);
      }
      
      simulations.sort((a, b) => a - b);
      
      // Apply floor to lower percentiles to prevent unrealistic downside
      const flooredP50 = Math.max(forecastFloor, simulations[Math.floor(simulationCount * 0.5)]);
      
      return {
        p10: Math.max(forecastFloor * 0.90, simulations[Math.floor(simulationCount * 0.1)]),
        p25: Math.max(forecastFloor * 0.95, simulations[Math.floor(simulationCount * 0.25)]),
        p50: flooredP50,
        // Ensure p75 and p90 are at least as high as p50 (monotonic percentiles)
        p75: Math.max(flooredP50 * 1.02, simulations[Math.floor(simulationCount * 0.75)]),
        p90: Math.max(flooredP50 * 1.05, simulations[Math.floor(simulationCount * 0.9)])
      };
    }

    // Generate monthly forecasts
    const asOfDate = today;
    const monthlyForecasts: any[] = [];
    let totalOnBooks = 0;
    let totalVelocityForecast = 0;
    let totalProbabilityForecast = 0;
    let totalBlendedForecast = 0;
    let velocitySum = 0;
    let totalOpenNights = 0;
    let totalProbabilitySum = 0;
    let monthsWithProbData = 0;

    console.log(`\n=== Enhanced Forecasting ${year} (as of ${asOfDate.toISOString().split('T')[0]}) ===\n`);

    for (let month = 0; month < 12; month++) {
      const forecast = forecastEnhanced(
        year,
        month,
        asOfDate,
        baselineByMonth,
        annualAverage,
        reservations || [],
        probabilityByDate,
        bookedDates,
        compsetDemandByMonth
      );
      
      monthlyForecasts.push(forecast);
      totalOnBooks += forecast.revenue_on_books;
      totalVelocityForecast += forecast.velocity_forecast;
      totalProbabilityForecast += forecast.probability_forecast;
      totalBlendedForecast += forecast.blended_forecast;
      velocitySum += forecast.velocity_factor;
      totalOpenNights += forecast.open_nights;
      
      if (forecast.avg_open_probability > 0) {
        totalProbabilitySum += forecast.avg_open_probability;
        monthsWithProbData++;
      }
    }

    const avgVelocity = velocitySum / 12;
    const avgOpenProbability = monthsWithProbData > 0 ? totalProbabilitySum / monthsWithProbData : 0;

    // Calculate overall compset demand index
    let compsetDemandIndex = 0;
    let compsetMonthsWithData = 0;
    compsetDemandByMonth.forEach(demand => {
      compsetDemandIndex += demand.occupancyRate; // 0..1
      compsetMonthsWithData++;
    });
    const avgCompsetDemand = compsetMonthsWithData > 0 ? (compsetDemandIndex / compsetMonthsWithData) * 100 : 0;

    // Apply floor: forecast should not be below prior year without strong evidence
    const calculatedForecast = totalBlendedForecast;
    const totalForecast = Math.max(calculatedForecast, forecastFloor);
    const floorApplied = totalForecast > calculatedForecast;

    console.log(
      `\n=== Annual Summary ===` +
      `\nOn Books: $${totalOnBooks.toFixed(0)}` +
      `\nVelocity Forecast: $${totalVelocityForecast.toFixed(0)}` +
      `\nProbability Forecast: $${totalProbabilityForecast.toFixed(0)}` +
      `\nBlended Forecast: $${totalBlendedForecast.toFixed(0)}` +
      `\nForecast Floor: $${forecastFloor.toFixed(0)}` +
      `\nFinal Forecast: $${totalForecast.toFixed(0)}${floorApplied ? ' (floor applied)' : ''}` +
      `\nAverage Velocity: ${avgVelocity.toFixed(2)}x` +
      `\nOpen Nights (remaining): ${totalOpenNights}` +
      `\nAvg Open Night Probability: ${avgOpenProbability.toFixed(1)}%` +
      `\nAvg Compset Demand: ${avgCompsetDemand.toFixed(1)}%\n`
    );

    // Run simulations with enhanced variance
    const simResults = simulateForecastEnhanced(monthlyForecasts, simulationCount, forecastFloor);

    console.log(
      `Simulation Results (${simulationCount} runs):` +
      `\nP10: $${simResults.p10.toFixed(0)}` +
      `\nP25: $${simResults.p25.toFixed(0)}` +
      `\nP50: $${simResults.p50.toFixed(0)}` +
      `\nP75: $${simResults.p75.toFixed(0)}` +
      `\nP90: $${simResults.p90.toFixed(0)}\n`
    );

    // Calculate goal probabilities (projection only)
    const totalProjection = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;

    const goalProbabilities = {
      projection: 0
    };

    if (goals && goals.length > 0 && totalProjection > 0) {
      // Run many simulations to calculate probabilities
      const simulations: number[] = [];
      for (let i = 0; i < simulationCount; i++) {
        let simTotal = 0;
        for (const forecast of monthlyForecasts) {
          let varianceRange = 0.20;
          switch (forecast.forecast_confidence) {
            case 'high': varianceRange = 0.10; break;
            case 'medium': varianceRange = 0.20; break;
            case 'low': varianceRange = 0.30; break;
          }
          const noise = (1 - varianceRange) + (Math.random() * varianceRange * 2);
          const simForecast = forecast.blended_forecast * noise;
          simTotal += Math.max(forecast.revenue_on_books, simForecast);
        }
        // Apply floor to simulations for goal probability calculation
        simulations.push(Math.max(simTotal, forecastFloor));
      }
      
      goalProbabilities.projection = 
        (simulations.filter(s => s >= totalProjection).length / simulationCount) * 100;
      
      console.log(
        `Goal Probabilities:` +
        `\n  Projection ($${totalProjection.toFixed(0)}): ${goalProbabilities.projection.toFixed(1)}%\n`
      );
    }

    // Generate insights (enhanced)
    const insights = {
      drivers: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[]
    };

    // Add floor insight if applied
    if (floorApplied) {
      insights.drivers.push(
        `Forecast floor applied: Based on ${year - 1} performance of $${priorYearActual.toFixed(0)} ` +
        `(raised from $${calculatedForecast.toFixed(0)} to $${totalForecast.toFixed(0)})`
      );
    }

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

    // NEW: Probability-based insights
    if (avgOpenProbability > 60 && totalOpenNights > 30) {
      insights.drivers.push(
        `High booking probability (${avgOpenProbability.toFixed(0)}% avg) across ${totalOpenNights} open nights`
      );
    }

    if (avgOpenProbability < 40 && totalOpenNights > 30) {
      insights.risks.push(
        `Low booking probability (${avgOpenProbability.toFixed(0)}% avg) for remaining open nights`
      );
      insights.opportunities.push(
        'Review pricing strategy - lower rates could improve booking probability'
      );
    }

    // NEW: Compset demand insights
    if (avgCompsetDemand > 70) {
      insights.drivers.push(
        `Strong market demand - compset averaging ${avgCompsetDemand.toFixed(0)}% occupancy`
      );
    } else if (avgCompsetDemand < 40 && avgCompsetDemand > 0) {
      insights.risks.push(
        `Weak market demand - compset only ${avgCompsetDemand.toFixed(0)}% occupied`
      );
    }

    // Identify months with demand/velocity mismatch
    const mismatchMonths = monthlyForecasts.filter(f => {
      if (!f.compset_demand || f.velocity_factor === 1.0) return false;
      const highDemandLowVelocity = f.compset_demand === 'High' && f.velocity_factor < 0.8;
      const lowDemandHighVelocity = f.compset_demand === 'Low' && f.velocity_factor > 1.2;
      return highDemandLowVelocity || lowDemandHighVelocity;
    });

    if (mismatchMonths.length > 0) {
      const highDemandLow = mismatchMonths.filter(f => f.compset_demand === 'High');
      const lowDemandHigh = mismatchMonths.filter(f => f.compset_demand === 'Low');
      
      if (highDemandLow.length > 0) {
        insights.opportunities.push(
          `${highDemandLow.map(f => f.month).join(', ')}: Market demand is high but you're pacing behind - pricing opportunity`
        );
      }
      if (lowDemandHigh.length > 0) {
        insights.risks.push(
          `${lowDemandHigh.map(f => f.month).join(', ')}: You're ahead of pace but market demand is weak - may not sustain`
        );
      }
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

    // Calculate probability-weighted revenue for storage
    const probabilityWeightedRevenue = totalOnBooks + 
      monthlyForecasts.reduce((sum, f) => sum + (f.expected_additional || 0), 0);

    const forecastData = {
      listing_id: listingId,
      year,
      forecast_method: 'baseline_velocity_probability',
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
      
      // NEW: Enhanced metrics
      probability_weighted_revenue: probabilityWeightedRevenue,
      avg_open_night_probability: avgOpenProbability,
      compset_demand_index: avgCompsetDemand,
      forecast_confidence: avgOpenProbability > 50 ? 'high' : avgOpenProbability > 30 ? 'medium' : 'low',
      
      // Monthly breakdown (enhanced)
      monthly_forecasts: monthlyForecasts,
      monthly_forecasts_enhanced: monthlyForecasts, // Same data, new column for compatibility
      
      // Goals
      goal_probabilities: goalProbabilities,
      goal_targets: {
        projection: totalProjection
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
        forecast_method: 'baseline_velocity_probability',
        pace_factor: avgVelocity,
        generated_at: today.toISOString(),
        revenue_on_books: totalOnBooks,
        forecasted_revenue: forecastData.forecasted_revenue,
        total_forecast: forecastData.total_forecast,
        goal_targets: forecastData.goal_targets,
        goal_probabilities: goalProbabilities,
        monthly_forecasts: monthlyForecasts,
        insights,
        // NEW columns
        probability_weighted_revenue: probabilityWeightedRevenue,
        avg_open_night_probability: avgOpenProbability,
        compset_demand_index: avgCompsetDemand,
        forecast_confidence: forecastData.forecast_confidence,
        monthly_forecasts_enhanced: monthlyForecasts
      }, {
        onConflict: 'listing_id,year'
      });

    if (saveError) {
      console.error('Error saving forecast:', saveError);
    } else {
      console.log('Enhanced RevPAR velocity + probability forecast saved successfully');
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
