// Booking Probability Calculator - Client-side recalculation for rate simulator

export type WeightMode = 'far_out' | 'standard' | 'close_in';

export interface DynamicWeights {
  compsetDemand: number;
  pricePosition: number;
  historical: number;
  bookingWindow: number;
}

export interface ProbabilityFactors {
  compsetDemandScore: number;
  pricePositionScore: number;
  historicalScore: number;
  bookingWindowScore: number;
}

export interface ProbabilityData {
  date: string;
  probability: number;
  compset_demand_score: number;
  price_position_score: number;
  historical_score: number;
  booking_window_score: number;
  compset_booked_count: number;
  compset_total_count: number;
  your_price: number | null;
  avg_available_rate: number | null;
  historical_date: string | null;
  historical_was_booked: boolean;
  historical_rate: number | null;
  historical_dba: number | null;
  current_dba: number | null;
  expected_booking_window: number | null;
  is_dba_outlier: boolean;
  // Dynamic weighting fields
  probability_mode?: WeightMode;
  historical_monthly_occupancy?: number;
  weights_used?: DynamicWeights;
}

export interface RateSuggestion {
  rate: number;
  probability: number;
  label: string;
  description: string;
}

/**
 * Get dynamic weights based on Days To Arrival and compset data availability
 */
export function getDynamicWeights(dta: number, hasCompsetBookings: boolean): { mode: WeightMode; weights: DynamicWeights } {
  // FAR OUT MODE: DTA > 90 days OR no compset bookings available
  if (dta > 90 || !hasCompsetBookings) {
    return {
      mode: 'far_out',
      weights: {
        compsetDemand: 0.10,
        pricePosition: 0.10,
        historical: 0.50,
        bookingWindow: 0.30,
      }
    };
  }
  
  // CLOSE-IN MODE: DTA < 30 days
  if (dta < 30) {
    return {
      mode: 'close_in',
      weights: {
        compsetDemand: 0.45,
        pricePosition: 0.35,
        historical: 0.12,
        bookingWindow: 0.08,
      }
    };
  }
  
  // STANDARD MODE: 30-90 days
  return {
    mode: 'standard',
    weights: {
      compsetDemand: 0.35,
      pricePosition: 0.30,
      historical: 0.20,
      bookingWindow: 0.15,
    }
  };
}

/**
 * Calculate the Price Position Score based on a rate vs the market average
 */
export function calculatePricePositionScore(rate: number, avgAvailableRate: number | null): number {
  if (!avgAvailableRate || avgAvailableRate <= 0) {
    return 50; // Neutral if no market data
  }

  const priceDiffPercent = ((avgAvailableRate - rate) / avgAvailableRate) * 100;

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
 * Recalculate the overall probability with a new rate using dynamic weights
 */
export function recalculateProbability(
  newRate: number,
  probabilityData: ProbabilityData
): {
  probability: number;
  pricePositionScore: number;
  factors: ProbabilityFactors;
  mode: WeightMode;
  weights: DynamicWeights;
} {
  // Determine mode based on DTA and compset data availability
  const hasCompsetBookings = probabilityData.compset_total_count > 0 && 
                             probabilityData.compset_booked_count > 0;
  const dta = probabilityData.current_dba || 0;
  
  // Use stored mode/weights if available, otherwise calculate
  const { mode, weights } = probabilityData.probability_mode && probabilityData.weights_used
    ? { mode: probabilityData.probability_mode, weights: probabilityData.weights_used }
    : getDynamicWeights(dta, hasCompsetBookings);

  const newPricePositionScore = calculatePricePositionScore(
    newRate,
    probabilityData.avg_available_rate
  );

  const factors: ProbabilityFactors = {
    compsetDemandScore: probabilityData.compset_demand_score,
    pricePositionScore: newPricePositionScore,
    historicalScore: probabilityData.historical_score,
    bookingWindowScore: probabilityData.booking_window_score,
  };

  // Use dynamic weights for calculation
  const probability =
    weights.compsetDemand * factors.compsetDemandScore +
    weights.pricePosition * factors.pricePositionScore +
    weights.historical * factors.historicalScore +
    weights.bookingWindow * factors.bookingWindowScore;

  return {
    probability: Math.round(probability * 100) / 100,
    pricePositionScore: newPricePositionScore,
    factors,
    mode,
    weights,
  };
}

/**
 * Generate rate suggestions for different strategies
 */
export function generateRateSuggestions(
  currentRate: number,
  avgAvailableRate: number | null,
  probabilityData: ProbabilityData
): RateSuggestion[] {
  if (!avgAvailableRate || avgAvailableRate <= 0) {
    return [];
  }

  const suggestions: RateSuggestion[] = [];
  const testRates: number[] = [];

  // Generate test rates from -30% to +20% of market rate
  for (let adjustment = -0.30; adjustment <= 0.20; adjustment += 0.05) {
    testRates.push(Math.round(avgAvailableRate * (1 + adjustment)));
  }

  // Also include current rate and some strategic points
  testRates.push(currentRate);
  testRates.push(Math.round(avgAvailableRate * 0.85)); // Quick book
  testRates.push(Math.round(avgAvailableRate * 0.95)); // Balanced
  testRates.push(Math.round(avgAvailableRate * 1.05)); // Max revenue

  // Remove duplicates and sort
  const uniqueRates = [...new Set(testRates)].sort((a, b) => a - b);

  // Calculate probability for each rate
  const rateProbs = uniqueRates.map(rate => ({
    rate,
    probability: recalculateProbability(rate, probabilityData).probability,
  }));

  // Find Quick Book (first rate with 90%+ probability)
  const quickBook = rateProbs.find(r => r.probability >= 90);
  if (quickBook) {
    suggestions.push({
      rate: quickBook.rate,
      probability: quickBook.probability,
      label: 'Quick Book',
      description: 'Fill gaps fast with high booking probability',
    });
  }

  // Find Balanced (rate with ~80-85% probability, prefer higher rate)
  const balanced = [...rateProbs]
    .reverse()
    .find(r => r.probability >= 78 && r.probability <= 88);
  if (balanced) {
    suggestions.push({
      rate: balanced.rate,
      probability: balanced.probability,
      label: 'Balanced',
      description: 'Good balance of revenue and occupancy',
    });
  }

  // Find Max Revenue (highest rate with 60%+ probability)
  const maxRevenue = [...rateProbs]
    .reverse()
    .find(r => r.probability >= 60);
  if (maxRevenue && maxRevenue.rate !== balanced?.rate) {
    suggestions.push({
      rate: maxRevenue.rate,
      probability: maxRevenue.probability,
      label: 'Max Revenue',
      description: 'Highest rate with reasonable booking chance',
    });
  }

  // Sort by rate descending
  return suggestions.sort((a, b) => b.rate - a.rate);
}

/**
 * Get probability color based on value
 */
export function getProbabilityColor(probability: number): {
  bg: string;
  text: string;
  badge: string;
} {
  if (probability >= 70) {
    return {
      bg: 'bg-emerald-100 dark:bg-emerald-950/50',
      text: 'text-emerald-700 dark:text-emerald-400',
      badge: 'bg-emerald-500',
    };
  } else if (probability >= 40) {
    return {
      bg: 'bg-amber-100 dark:bg-amber-950/50',
      text: 'text-amber-700 dark:text-amber-400',
      badge: 'bg-amber-500',
    };
  } else {
    return {
      bg: 'bg-red-100 dark:bg-red-950/50',
      text: 'text-red-700 dark:text-red-400',
      badge: 'bg-red-500',
    };
  }
}

/**
 * Get booking window status description
 */
export function getBookingWindowStatus(
  currentDba: number | null,
  expectedWindow: number | null
): { status: string; description: string; color: string } {
  if (currentDba === null || expectedWindow === null) {
    return {
      status: 'Unknown',
      description: 'No booking window data available',
      color: 'text-muted-foreground',
    };
  }

  const ratio = currentDba / expectedWindow;

  if (ratio > 1.5) {
    return {
      status: 'Too Early',
      description: `Bookings typically come ${expectedWindow} days out. You're ${currentDba} days out.`,
      color: 'text-blue-600 dark:text-blue-400',
    };
  } else if (ratio >= 0.8) {
    return {
      status: 'Prime Window',
      description: `Within the typical booking window of ${expectedWindow} days`,
      color: 'text-emerald-600 dark:text-emerald-400',
    };
  } else if (ratio >= 0.5) {
    return {
      status: 'Getting Late',
      description: `Only ${currentDba} days left. Expected window is ${expectedWindow} days.`,
      color: 'text-amber-600 dark:text-amber-400',
    };
  } else {
    return {
      status: 'Last Minute',
      description: `Only ${currentDba} days away - very last minute!`,
      color: 'text-red-600 dark:text-red-400',
    };
  }
}

/**
 * Get mode display info for UI
 */
export function getModeDisplayInfo(mode: WeightMode): {
  label: string;
  description: string;
  color: string;
  bgColor: string;
} {
  switch (mode) {
    case 'far_out':
      return {
        label: 'Historical Trends',
        description: 'This date is 90+ days away or compset data is sparse. Probability is based primarily on historical booking patterns.',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-100 dark:bg-blue-950/50',
      };
    case 'close_in':
      return {
        label: 'Market Focused',
        description: 'This date is within 30 days. Probability is heavily weighted toward current compset availability and pricing.',
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-100 dark:bg-orange-950/50',
      };
    default:
      return {
        label: 'Balanced',
        description: 'Using balanced weights across compset, pricing, and historical factors.',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
      };
  }
}
