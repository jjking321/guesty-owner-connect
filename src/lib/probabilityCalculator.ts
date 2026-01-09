// Booking Probability Calculator - Client-side recalculation for rate simulator

export interface ProbabilityFactors {
  compsetDemandScore: number;
  pricePositionScore: number;
  historicalScore: number;
  bookingWindowScore: number;
}

export interface ProbabilityData {
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
}

export interface RateSuggestion {
  rate: number;
  probability: number;
  label: string;
  description: string;
}

// Weights for the probability model
const WEIGHTS = {
  compsetDemand: 0.35,
  pricePosition: 0.30,
  historical: 0.20,
  bookingWindow: 0.15,
};

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
 * Recalculate the overall probability with a new rate
 * Only the Price Position Score changes; other factors remain the same
 */
export function recalculateProbability(
  newRate: number,
  probabilityData: ProbabilityData
): {
  probability: number;
  pricePositionScore: number;
  factors: ProbabilityFactors;
} {
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

  const probability =
    WEIGHTS.compsetDemand * factors.compsetDemandScore +
    WEIGHTS.pricePosition * factors.pricePositionScore +
    WEIGHTS.historical * factors.historicalScore +
    WEIGHTS.bookingWindow * factors.bookingWindowScore;

  return {
    probability: Math.round(probability * 100) / 100,
    pricePositionScore: newPricePositionScore,
    factors,
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
