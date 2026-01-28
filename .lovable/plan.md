

# Capacity-Constrained Forecast Enhancement

## Problem Summary
The forecast for 102 De Leon shows $11,931 for February 2026, but this is physically impossible:
- **19 nights already booked**: $6,653 confirmed revenue
- **9 nights still available**: Maximum possible = 9 × $377 avg rate = $3,393
- **Realistic maximum**: $6,653 + $3,393 = **$10,046**

The current forecast uses compset baselines and velocity factors but ignores the fundamental constraint: **you can't earn more than (available nights × asking rate)**.

## Root Cause
1. **No booking probabilities calculated** for this property (0 records exist)
2. Even when probabilities exist, the forecast doesn't apply a **capacity ceiling**
3. The compset baseline ($11,931) assumes full-month potential without checking what's actually bookable

## Solution: Add Capacity-Constrained Ceiling

Enhance the forecast to:
1. **Fetch capacity data** for each month to know what's actually bookable
2. **Calculate revenue ceiling** = On Books + (Available Nights × Avg Asking Rate)
3. **Cap the forecast** so it never exceeds what's physically achievable
4. **Adjust probability weighting** to reflect realistic booking expectations

### Implementation Details

**File: `supabase/functions/forecast-revenue/index.ts`**

#### Change 1: Fetch capacity_calendar data
```typescript
// Fetch capacity calendar for available nights and asking rates
const { data: capacityData, error: capacityError } = await supabase
  .from('capacity_calendar')
  .select('date, price, status')
  .eq('listing_id', listingId)
  .gte('date', `${year}-01-01`)
  .lte('date', `${year}-12-31`);
```

#### Change 2: Build monthly capacity summary
```typescript
// Build capacity summary by month
const capacityByMonth: Record<number, {
  availableNights: number;
  bookedNights: number;
  avgAskingRate: number;
  maxPossibleRevenue: number;
}> = {};

for (const day of capacityData || []) {
  const month = new Date(day.date).getMonth();
  if (!capacityByMonth[month]) {
    capacityByMonth[month] = {
      availableNights: 0,
      bookedNights: 0,
      avgAskingRate: 0,
      maxPossibleRevenue: 0,
      prices: [] // for averaging
    };
  }
  
  if (day.status === 'available') {
    capacityByMonth[month].availableNights++;
    capacityByMonth[month].prices.push(day.price);
  } else if (day.status === 'booked') {
    capacityByMonth[month].bookedNights++;
  }
}

// Calculate averages and max possible revenue
for (const month of Object.keys(capacityByMonth)) {
  const cap = capacityByMonth[month];
  cap.avgAskingRate = cap.prices.length > 0 
    ? cap.prices.reduce((a, b) => a + b, 0) / cap.prices.length 
    : 0;
  cap.maxPossibleRevenue = cap.availableNights * cap.avgAskingRate;
}
```

#### Change 3: Apply capacity ceiling in forecastEnhanced()
```typescript
// After calculating blended forecast...

// Step 8: Apply capacity ceiling
const capacity = capacityByMonth[targetMonth];
if (capacity) {
  const revenueOnBooks = onBooks;
  const maxAdditional = capacity.availableNights * capacity.avgAskingRate;
  const capacityCeiling = revenueOnBooks + maxAdditional;
  
  // Forecast cannot exceed what's physically possible
  if (blendedForecast > capacityCeiling) {
    console.log(
      `  → Capacity ceiling applied: ${blendedForecast.toFixed(0)} → ${capacityCeiling.toFixed(0)} ` +
      `(${capacity.availableNights} avail nights × $${capacity.avgAskingRate.toFixed(0)} = $${maxAdditional.toFixed(0)} max additional)`
    );
    blendedForecast = capacityCeiling;
  }
}

// Ensure blended forecast is at least what's on books
blendedForecast = Math.max(blendedForecast, onBooks);
```

#### Change 4: Apply booking probability to available nights
Rather than assuming 100% of available nights will book, apply a realistic probability:
```typescript
// Calculate expected additional revenue using probability estimates
let expectedAdditionalRevenue: number;

if (probExpected.openNights > 0 && probExpected.avgProbability > 0) {
  // Use calculated probabilities
  expectedAdditionalRevenue = probExpected.expectedValue;
} else if (capacity && capacity.availableNights > 0) {
  // Fallback: Use compset occupancy as probability proxy
  const compsetOccupancy = compsetDemand?.occupancyRate || 0.5; // 50% default
  expectedAdditionalRevenue = capacity.availableNights * capacity.avgAskingRate * compsetOccupancy;
}

// Probability-capped forecast
const probabilityCappedForecast = onBooks + expectedAdditionalRevenue;
```

## Example: February 2026 for 102 De Leon

| Metric | Before | After |
|--------|--------|-------|
| Compset Baseline | $11,931 | $11,931 |
| On Books | $6,653 | $6,653 |
| Available Nights | (ignored) | 9 nights |
| Avg Asking Rate | (ignored) | $377 |
| Max Additional | (no limit) | $3,393 |
| Capacity Ceiling | N/A | $10,046 |
| Compset Occupancy | N/A | ~65% |
| Expected Additional | (formula-based) | $2,205 |
| **Final Forecast** | **$11,931** | **$8,858** |

## Additional Enhancement: Log capacity constraints for visibility
```typescript
// Add to monthly forecast output
capacity_ceiling: capacityCeiling,
available_nights: capacity?.availableNights || null,
avg_asking_rate: capacity?.avgAskingRate || null,
capacity_constrained: blendedForecast === capacityCeiling
```

## Changes Summary

| File | Changes |
|------|---------|
| `supabase/functions/forecast-revenue/index.ts` | Add capacity_calendar query, build monthly capacity map, apply ceiling logic, include capacity fields in output |

## Testing Plan
1. Regenerate forecast for 102 De Leon
2. Verify February 2026 shows ~$8,500-9,500 (not $11,931)
3. Check logs show "Capacity ceiling applied" message
4. Ensure months with ample availability aren't artificially capped
5. Verify established properties with full history still work correctly

## What You'll See After This Fix
- February forecast drops from $11,931 to a realistic ~$8,500-9,500
- Each month shows awareness of remaining bookable nights
- Forecasts become more actionable for pricing decisions
- Cold start properties get grounded in both market data AND physical constraints

