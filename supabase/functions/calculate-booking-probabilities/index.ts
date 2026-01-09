import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FutureRate {
  date: string;
  available: boolean;
  rate: number;
}

interface ComparableWithRates {
  airroi_listing_id: string;
  future_rates: { rates: FutureRate[] } | null;
}

interface CalendarDay {
  date: string;
  price: number | null;
  is_available: boolean;
  status: string | null;
  block_reason: string | null;
}

interface ReservationNight {
  night_date: string;
  revenue_allocation: number;
}

interface BookingStats {
  median_booking_window: number;
  avg_booking_window: number;
  stddev_booking_window: number;
  monthly_avg_windows: Record<number, number>;
  total_bookings_analyzed: number;
}

// Weights for probability calculation
const WEIGHTS = {
  compsetDemand: 0.35,
  pricePosition: 0.30,
  historical: 0.20,
  bookingWindow: 0.15,
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listingId, startDate, endDate } = await req.json();

    if (!listingId) {
      return new Response(
        JSON.stringify({ error: "listingId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date();
    const start = startDate ? new Date(startDate) : today;
    const end = endDate ? new Date(endDate) : new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

    console.log(`Calculating probabilities for listing ${listingId} from ${start.toISOString()} to ${end.toISOString()}`);

    // 1. Calculate and cache booking stats
    const bookingStats = await calculateBookingStats(supabase, listingId);
    console.log("Booking stats:", bookingStats);

    // 2. Fetch calendar data
    const { data: calendarData, error: calendarError } = await supabase
      .from("capacity_calendar")
      .select("date, price, is_available, status, block_reason")
      .eq("listing_id", listingId)
      .gte("date", start.toISOString().split("T")[0])
      .lte("date", end.toISOString().split("T")[0])
      .order("date");

    if (calendarError) throw calendarError;
    console.log(`Found ${calendarData?.length || 0} calendar days`);

    // 3. Fetch compset future rates
    const { data: compsetData, error: compsetError } = await supabase
      .from("property_comparables")
      .select("airroi_listing_id, future_rates")
      .eq("listing_id", listingId)
      .eq("is_selected", true)
      .not("future_rates", "is", null);

    if (compsetError) throw compsetError;
    console.log(`Found ${compsetData?.length || 0} comparables with rates`);

    // 4. Fetch historical reservation nights (last year)
    const lastYearStart = new Date(start);
    lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
    const lastYearEnd = new Date(end);
    lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);

    const { data: historicalNights, error: historicalError } = await supabase
      .from("reservation_nights")
      .select("night_date, revenue_allocation")
      .eq("listing_id", listingId)
      .gte("night_date", lastYearStart.toISOString().split("T")[0])
      .lte("night_date", lastYearEnd.toISOString().split("T")[0]);

    if (historicalError) throw historicalError;
    console.log(`Found ${historicalNights?.length || 0} historical nights`);

    // 5. Fetch historical reservation info for booking window analysis
    const { data: historicalReservations, error: resError } = await supabase
      .from("reservations")
      .select("check_in, created_at_guesty, fare_accommodation_adjusted, nights_count")
      .eq("listing_id", listingId)
      .gte("check_in", lastYearStart.toISOString().split("T")[0])
      .lte("check_in", lastYearEnd.toISOString().split("T")[0])
      .in("status", ["confirmed", "checked_in", "checked_out"]);

    if (resError) throw resError;

    // Build lookup maps
    const historicalNightsMap = new Map<string, number>();
    historicalNights?.forEach((night: ReservationNight) => {
      historicalNightsMap.set(night.night_date, night.revenue_allocation);
    });

    // Build historical DBA map (when was each date booked last year)
    const historicalDbaMap = new Map<string, number>();
    historicalReservations?.forEach((res: any) => {
      if (res.check_in && res.created_at_guesty) {
        const checkIn = new Date(res.check_in);
        const createdAt = new Date(res.created_at_guesty);
        const dba = Math.floor((checkIn.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        
        // For each night of the reservation
        const nights = res.nights_count || 1;
        for (let i = 0; i < nights; i++) {
          const nightDate = new Date(checkIn);
          nightDate.setDate(nightDate.getDate() + i);
          const nightStr = nightDate.toISOString().split("T")[0];
          // Keep the earliest DBA if multiple reservations
          if (!historicalDbaMap.has(nightStr) || dba < historicalDbaMap.get(nightStr)!) {
            historicalDbaMap.set(nightStr, dba);
          }
        }
      }
    });

    // Build compset rates map
    const compsetRatesMap = buildCompsetRatesMap(compsetData as ComparableWithRates[]);

    // 6. Calculate probabilities for each future available date
    const probabilities: any[] = [];

    for (const day of calendarData || []) {
      const date = new Date(day.date);
      
      // Skip past dates
      if (date < today) continue;
      
      // Skip booked/blocked dates
      if (day.status === "booked" || day.block_reason === "reservation" || 
          day.status === "unavailable" || day.block_reason === "blocked") {
        continue;
      }

      // Only process available dates
      if (!day.is_available) continue;

      const currentDba = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const dateStr = day.date;

      // Factor 1: Compset Demand Score
      const compsetInfo = compsetRatesMap.get(dateStr);
      const { compsetDemandScore, bookedCount, totalCount, avgAvailableRate } = 
        calculateCompsetDemandScore(compsetInfo);

      // Factor 2: Price Position Score
      const pricePositionScore = calculatePricePositionScore(day.price, avgAvailableRate);

      // Factor 3: Historical Score
      const historicalDate = findEquivalentDateLastYear(date);
      const historicalDateStr = historicalDate.toISOString().split("T")[0];
      const historicalRate = historicalNightsMap.get(historicalDateStr);
      const historicalWasBooked = historicalRate !== undefined && historicalRate > 0;
      const { historicalScore, historicalDba } = calculateHistoricalScore(
        historicalWasBooked,
        historicalRate || null,
        day.price,
        historicalDbaMap.get(historicalDateStr) || null
      );

      // Factor 4: Booking Window Score
      const expectedWindow = bookingStats.monthly_avg_windows[date.getMonth() + 1] || 
                             bookingStats.avg_booking_window || 30;
      const lastYearDba = historicalDbaMap.get(historicalDateStr);
      const isDbaOutlier = lastYearDba !== undefined && 
                           lastYearDba > (bookingStats.median_booking_window + 2 * bookingStats.stddev_booking_window);
      const bookingWindowScore = calculateBookingWindowScore(
        currentDba,
        expectedWindow,
        lastYearDba || null,
        isDbaOutlier
      );

      // Calculate weighted probability
      const probability = 
        WEIGHTS.compsetDemand * compsetDemandScore +
        WEIGHTS.pricePosition * pricePositionScore +
        WEIGHTS.historical * historicalScore +
        WEIGHTS.bookingWindow * bookingWindowScore;

      probabilities.push({
        listing_id: listingId,
        date: dateStr,
        probability: Math.round(probability * 100) / 100,
        compset_demand_score: Math.round(compsetDemandScore * 100) / 100,
        price_position_score: Math.round(pricePositionScore * 100) / 100,
        historical_score: Math.round(historicalScore * 100) / 100,
        booking_window_score: Math.round(bookingWindowScore * 100) / 100,
        compset_booked_count: bookedCount,
        compset_total_count: totalCount,
        your_price: day.price,
        avg_available_rate: avgAvailableRate ? Math.round(avgAvailableRate) : null,
        historical_date: historicalDateStr,
        historical_was_booked: historicalWasBooked,
        historical_rate: historicalRate || null,
        historical_dba: lastYearDba || null,
        current_dba: currentDba,
        expected_booking_window: Math.round(expectedWindow),
        is_dba_outlier: isDbaOutlier,
        calculated_at: new Date().toISOString(),
      });
    }

    console.log(`Calculated ${probabilities.length} probabilities`);

    // 7. Upsert probabilities
    if (probabilities.length > 0) {
      // Batch upsert in chunks
      const chunkSize = 100;
      for (let i = 0; i < probabilities.length; i += chunkSize) {
        const chunk = probabilities.slice(i, i + chunkSize);
        const { error: upsertError } = await supabase
          .from("booking_probabilities")
          .upsert(chunk, { onConflict: "listing_id,date" });

        if (upsertError) {
          console.error("Upsert error:", upsertError);
          throw upsertError;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Calculated probabilities for ${probabilities.length} dates`,
        stats: {
          datesProcessed: probabilities.length,
          avgProbability: probabilities.length > 0 
            ? Math.round(probabilities.reduce((sum, p) => sum + p.probability, 0) / probabilities.length)
            : 0,
          bookingStats,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error calculating probabilities:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Calculate and cache booking stats for the listing
 */
async function calculateBookingStats(supabase: any, listingId: string): Promise<BookingStats> {
  // Check if we have recent stats cached
  const { data: cachedStats } = await supabase
    .from("listing_booking_stats")
    .select("*")
    .eq("listing_id", listingId)
    .single();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (cachedStats && new Date(cachedStats.calculated_at) > oneHourAgo) {
    return {
      median_booking_window: cachedStats.median_booking_window || 30,
      avg_booking_window: cachedStats.avg_booking_window || 30,
      stddev_booking_window: cachedStats.stddev_booking_window || 20,
      monthly_avg_windows: cachedStats.monthly_avg_windows || {},
      total_bookings_analyzed: cachedStats.total_bookings_analyzed || 0,
    };
  }

  // Calculate fresh stats from reservations
  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("check_in, created_at_guesty")
    .eq("listing_id", listingId)
    .in("status", ["confirmed", "checked_in", "checked_out"])
    .not("created_at_guesty", "is", null)
    .not("check_in", "is", null);

  if (error || !reservations || reservations.length === 0) {
    return {
      median_booking_window: 30,
      avg_booking_window: 30,
      stddev_booking_window: 20,
      monthly_avg_windows: {},
      total_bookings_analyzed: 0,
    };
  }

  // Calculate booking windows (DBA)
  const bookingWindows: number[] = [];
  const monthlyWindows: Record<number, number[]> = {};

  for (const res of reservations) {
    const checkIn = new Date(res.check_in);
    const createdAt = new Date(res.created_at_guesty);
    const dba = Math.floor((checkIn.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    
    if (dba >= 0 && dba < 365) { // Filter outliers
      bookingWindows.push(dba);
      const month = checkIn.getMonth() + 1;
      if (!monthlyWindows[month]) monthlyWindows[month] = [];
      monthlyWindows[month].push(dba);
    }
  }

  if (bookingWindows.length === 0) {
    return {
      median_booking_window: 30,
      avg_booking_window: 30,
      stddev_booking_window: 20,
      monthly_avg_windows: {},
      total_bookings_analyzed: 0,
    };
  }

  // Calculate stats
  bookingWindows.sort((a, b) => a - b);
  const median = bookingWindows[Math.floor(bookingWindows.length / 2)];
  const avg = bookingWindows.reduce((sum, w) => sum + w, 0) / bookingWindows.length;
  const variance = bookingWindows.reduce((sum, w) => sum + Math.pow(w - avg, 2), 0) / bookingWindows.length;
  const stddev = Math.sqrt(variance);

  // Calculate monthly averages
  const monthlyAvgWindows: Record<number, number> = {};
  for (const [month, windows] of Object.entries(monthlyWindows)) {
    monthlyAvgWindows[parseInt(month)] = Math.round(
      windows.reduce((sum, w) => sum + w, 0) / windows.length
    );
  }

  const stats: BookingStats = {
    median_booking_window: Math.round(median),
    avg_booking_window: Math.round(avg),
    stddev_booking_window: Math.round(stddev),
    monthly_avg_windows: monthlyAvgWindows,
    total_bookings_analyzed: bookingWindows.length,
  };

  // Cache the stats
  await supabase
    .from("listing_booking_stats")
    .upsert({
      listing_id: listingId,
      ...stats,
      calculated_at: new Date().toISOString(),
    }, { onConflict: "listing_id" });

  return stats;
}

/**
 * Build a map of date -> compset rate info
 */
function buildCompsetRatesMap(compsetData: ComparableWithRates[]): Map<string, { rates: FutureRate[] }> {
  const map = new Map<string, { rates: FutureRate[] }>();

  for (const comp of compsetData || []) {
    if (!comp.future_rates?.rates) continue;

    for (const rate of comp.future_rates.rates) {
      if (!rate.rate || rate.rate <= 0) continue;

      const existing = map.get(rate.date);
      if (existing) {
        existing.rates.push(rate);
      } else {
        map.set(rate.date, { rates: [rate] });
      }
    }
  }

  return map;
}

/**
 * Calculate Compset Demand Score
 */
function calculateCompsetDemandScore(compsetInfo: { rates: FutureRate[] } | undefined): {
  compsetDemandScore: number;
  bookedCount: number;
  totalCount: number;
  avgAvailableRate: number | null;
} {
  if (!compsetInfo || compsetInfo.rates.length === 0) {
    return { compsetDemandScore: 50, bookedCount: 0, totalCount: 0, avgAvailableRate: null };
  }

  const bookedCount = compsetInfo.rates.filter(r => !r.available).length;
  const totalCount = compsetInfo.rates.length;
  
  // Calculate average rate of available comps
  const availableRates = compsetInfo.rates.filter(r => r.available).map(r => r.rate);
  const avgAvailableRate = availableRates.length > 0 
    ? availableRates.reduce((sum, r) => sum + r, 0) / availableRates.length
    : null;

  // Compset demand score = percentage of comps booked
  const compsetDemandScore = (bookedCount / totalCount) * 100;

  return { compsetDemandScore, bookedCount, totalCount, avgAvailableRate };
}

/**
 * Calculate Price Position Score
 */
function calculatePricePositionScore(myPrice: number | null, avgAvailableRate: number | null): number {
  if (!myPrice || !avgAvailableRate || avgAvailableRate <= 0) {
    return 50; // Neutral if no comparison data
  }

  const priceDiffPercent = ((avgAvailableRate - myPrice) / avgAvailableRate) * 100;

  if (priceDiffPercent >= 15) {
    // 15%+ below market → 90-100%
    return Math.min(100, 90 + (priceDiffPercent - 15) * 0.5);
  } else if (priceDiffPercent >= 5) {
    // 5-15% below market → 70-89%
    return 70 + ((priceDiffPercent - 5) / 10) * 19;
  } else if (priceDiffPercent >= -5) {
    // ±5% of market → 40-69%
    return 40 + ((priceDiffPercent + 5) / 10) * 29;
  } else if (priceDiffPercent >= -15) {
    // 5-15% above market → 20-39%
    return 20 + ((priceDiffPercent + 15) / 10) * 19;
  } else {
    // 15%+ above market → 0-19%
    return Math.max(0, 20 + (priceDiffPercent + 15) * 0.5);
  }
}

/**
 * Find the equivalent date last year (day-of-week adjusted)
 */
function findEquivalentDateLastYear(date: Date): Date {
  const lastYear = new Date(date);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  
  // Get target day of week and week number within month
  const targetDayOfWeek = date.getDay();
  const targetWeekOfMonth = Math.ceil(date.getDate() / 7);
  
  // Go to the 1st of the same month last year
  const monthStart = new Date(lastYear.getFullYear(), lastYear.getMonth(), 1);
  
  // Find the first occurrence of the target day of week
  let firstOccurrence = new Date(monthStart);
  while (firstOccurrence.getDay() !== targetDayOfWeek) {
    firstOccurrence.setDate(firstOccurrence.getDate() + 1);
  }
  
  // Add weeks to get to the target week
  const equivalentDate = new Date(firstOccurrence);
  equivalentDate.setDate(equivalentDate.getDate() + (targetWeekOfMonth - 1) * 7);
  
  // Make sure we're still in the same month
  if (equivalentDate.getMonth() !== lastYear.getMonth()) {
    // Fall back to the last occurrence in the month
    equivalentDate.setDate(equivalentDate.getDate() - 7);
  }
  
  return equivalentDate;
}

/**
 * Calculate Historical Score
 */
function calculateHistoricalScore(
  wasBooked: boolean,
  historicalRate: number | null,
  currentRate: number | null,
  historicalDba: number | null
): { historicalScore: number; historicalDba: number | null } {
  let score = 50; // Default neutral

  if (wasBooked) {
    score = 80; // Base score for being booked last year

    // Rate adjustment bonus/penalty
    if (historicalRate && currentRate) {
      const rateDiff = ((historicalRate - currentRate) / historicalRate) * 100;
      if (rateDiff > 10) {
        // Current rate is significantly lower → bonus
        score = Math.min(100, score + 10);
      } else if (rateDiff < -10) {
        // Current rate is significantly higher → penalty
        score = Math.max(60, score - 10);
      }
    }
  } else {
    score = 30; // Lower probability if not booked last year
  }

  return { historicalScore: score, historicalDba };
}

/**
 * Calculate Booking Window Score
 */
function calculateBookingWindowScore(
  currentDba: number,
  expectedWindow: number,
  lastYearDba: number | null,
  isDbaOutlier: boolean
): number {
  let score = 50; // Default

  // Score based on timing relative to expected window
  if (currentDba > expectedWindow * 1.5) {
    // Too early, bookings typically come later
    score = 40 + (expectedWindow / currentDba) * 20;
  } else if (currentDba >= expectedWindow * 0.8) {
    // Within prime booking window
    score = 80;
  } else if (currentDba >= expectedWindow * 0.5) {
    // Getting late but still possible
    score = 60;
  } else if (currentDba >= 7) {
    // Last couple weeks
    score = 45;
  } else {
    // Very last minute (< 7 days)
    score = 30 + currentDba * 2;
  }

  // Adjustment based on last year's booking timing
  if (lastYearDba !== null && !isDbaOutlier) {
    if (Math.abs(currentDba - lastYearDba) <= 7) {
      // We're at similar timing to when it was booked last year
      score = Math.min(100, score + 10);
    } else if (currentDba > lastYearDba + 14) {
      // We're earlier than when it was booked last year - still time
      score = Math.min(100, score + 5);
    } else if (currentDba < lastYearDba - 14) {
      // We're later than when it was booked last year - might miss window
      score = Math.max(20, score - 10);
    }
  }

  return score;
}
