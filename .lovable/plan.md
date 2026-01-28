

# Enhanced Forecast Accuracy: Apply Occupancy BEFORE Capacity Ceiling + Lead Time Decay

## Current Problem
The February 2026 forecast of **$10,044** is still too high because:

1. **Capacity ceiling is applied BEFORE probability adjustment** - The code hits the 100% capacity ceiling ($10,044) and sets `capacityConstrained = true`, which prevents the more realistic probability cap from being applied
2. **Fallback to 50% occupancy** - When no booking probabilities exist, the code falls back to `compset_occupancy || 0.5`, but `compsetDemandByMonth` is empty (future_monthly_averages has 0 entries), so it defaults to 50% instead of using the historical 76-84% February occupancy
3. **No lead time decay** - With only 18 days until mid-February, some nights may be too late to book based on this property's booking patterns (61% of bookings come 60+ days out)

## Data Analysis

### Your February 2026 Calendar
- **9 available nights**: Feb 1-7, Feb 22, Feb 28
- **19 booked nights**: $6,653 confirmed
- **Asking rates**: $331-$446 (avg $377)

### Compset Historical February Occupancy
| Year | Occupancy | Revenue |
|------|-----------|---------|
| 2025 | 84% | $10,797 |
| 2024 | 72% | $9,288 |
| 2023 | 72% | $8,267 |
| 2022 | 92% | $8,283 |
| **Avg** | **~76-80%** | **$9,159** |

### Your Booking Lead Time Pattern
| Lead Time | Bookings | Share |
|-----------|----------|-------|
| 60+ days | 11 | 61% |
| 30-60 days | 1 | 6% |
| 14-30 days | 1 | 6% |
| 7-14 days | 2 | 11% |
| 0-7 days | 3 | 17% |

Most bookings come 60+ days out. Feb 1-7 are only 4-10 days away - these are in "last minute" territory.

## Solution: Three-Part Fix

### Part 1: Use Historical Compset Occupancy When Future Data is Missing
```typescript
// In forecastEnhanced(), before capacity ceiling logic:

// Look up historical occupancy for same month if future data missing
let monthOccupancy = compsetDemand?.occupancyRate;

if (!monthOccupancy && compsetSummary?.monthly_averages) {
  // Find matching month from historical data (e.g., any "-02" for February)
  const historicalMonths = (compsetSummary.monthly_averages as any[])
    .filter(m => {
      const monthKey = m.month || '';
      return monthKey.endsWith(`-${String(targetMonth + 1).padStart(2, '0')}`);
    });
  
  if (historicalMonths.length > 0) {
    // Average the occupancy across available years
    const totalOcc = historicalMonths.reduce((sum, m) => 
      sum + (m.occupancy || m.occupancy_rate || 0), 0);
    monthOccupancy = totalOcc / historicalMonths.length;
    
    // Normalize to 0-1 if percentage
    if (monthOccupancy > 1) monthOccupancy = monthOccupancy / 100;
  }
}

// Default to 65% if still no data
monthOccupancy = monthOccupancy || 0.65;
```

### Part 2: Apply Lead Time Decay to Available Nights
Different DBA (days before arrival) have different booking probabilities:

```typescript
// Calculate probability-weighted available nights
function applyLeadTimeDecay(
  availableNights: { date: string; price: number }[],
  bookingStats: { median_booking_window: number },
  today: Date
): { effectiveNights: number; weightedRevenue: number } {
  
  let effectiveNights = 0;
  let weightedRevenue = 0;
  
  for (const night of availableNights) {
    const nightDate = new Date(night.date);
    const dba = Math.floor((nightDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    // Lead time decay factor based on typical booking window
    let leadTimeFactor: number;
    const medianWindow = bookingStats.median_booking_window || 30;
    
    if (dba > medianWindow * 2) {
      // Very far out - still time, but some uncertainty
      leadTimeFactor = 0.85;
    } else if (dba >= medianWindow) {
      // Prime booking window
      leadTimeFactor = 1.0;
    } else if (dba >= medianWindow * 0.5) {
      // Getting late
      leadTimeFactor = 0.75;
    } else if (dba >= 7) {
      // Last minute territory
      leadTimeFactor = 0.50;
    } else {
      // Very last minute (0-7 days)
      leadTimeFactor = 0.30;
    }
    
    effectiveNights += leadTimeFactor;
    weightedRevenue += night.price * leadTimeFactor;
  }
  
  return { effectiveNights, weightedRevenue };
}
```

### Part 3: Apply Probability Adjustment BEFORE Capacity Ceiling
The key fix is ordering - calculate the realistic probability-adjusted forecast FIRST:

```typescript
// Step 7 (NEW): Calculate probability-adjusted forecast FIRST
let probabilityAdjustedForecast: number | null = null;

if (capacity && capacity.availableNights > 0) {
  // Get lead-time weighted available nights
  const leadTimeAdjusted = applyLeadTimeDecay(
    capacity.availableNightsDetails, // Need to pass the actual dates
    bookingStats,
    asOfDate
  );
  
  // Expected additional = weighted nights × avg rate × compset occupancy
  const expectedAdditional = leadTimeAdjusted.weightedRevenue * monthOccupancy;
  
  probabilityAdjustedForecast = onBooks + expectedAdditional;
  
  if (blendedForecast > probabilityAdjustedForecast) {
    console.log(
      `  → Probability adjusted: $${blendedForecast.toFixed(0)} → $${probabilityAdjustedForecast.toFixed(0)} ` +
      `(${leadTimeAdjusted.effectiveNights.toFixed(1)} effective nights × ${(monthOccupancy * 100).toFixed(0)}% occ)`
    );
    blendedForecast = probabilityAdjustedForecast;
  }
}

// Step 8: Apply capacity ceiling as ABSOLUTE maximum (safety cap)
// This is now a backup, not the primary constraint
```

## Example Calculation for February 2026

### Available Nights with Lead Time Decay (as of Jan 28)
| Date | Asking Rate | DBA | Lead Time Factor | Weighted Value |
|------|-------------|-----|------------------|----------------|
| Feb 1 | $356 | 4 | 0.30 | $107 |
| Feb 2 | $331 | 5 | 0.30 | $99 |
| Feb 3 | $332 | 6 | 0.30 | $100 |
| Feb 4 | $344 | 7 | 0.50 | $172 |
| Feb 5 | $379 | 8 | 0.50 | $190 |
| Feb 6 | $445 | 9 | 0.50 | $223 |
| Feb 7 | $446 | 10 | 0.50 | $223 |
| Feb 22 | $344 | 25 | 0.75 | $258 |
| Feb 28 | $414 | 31 | 1.00 | $414 |
| **Total** | | | **4.65 eff nights** | **$1,786** |

### Final Calculation
- **On Books**: $6,653
- **Weighted Available Value**: $1,786
- **Compset Occupancy**: 80% (Feb historical avg)
- **Expected Additional**: $1,786 × 80% = **$1,429**
- **Probability-Adjusted Forecast**: $6,653 + $1,429 = **$8,082**
- **Capacity Ceiling**: $10,044 (backup max)
- **Final Forecast**: **$8,082**

## Additional Accuracy Improvements

### 1. Day-of-Week Weighting (Future Enhancement)
Your booking data shows uniform day-of-week distribution (13-14 nights each). For now, this isn't a factor, but for properties with weekend-heavy patterns, this could be added.

### 2. Price Position Adjustment
If your rates are significantly above/below compset, adjust probability accordingly:
```typescript
const priceRatio = avgAskingRate / compsetAvgRate;
let priceAdjustment = 1.0;
if (priceRatio > 1.15) priceAdjustment = 0.85; // 15%+ above market
else if (priceRatio > 1.05) priceAdjustment = 0.92; // 5-15% above
else if (priceRatio < 0.85) priceAdjustment = 1.10; // 15%+ below

expectedAdditional *= priceAdjustment;
```

### 3. Booking Probabilities Calculation
Run `calculate-booking-probabilities` for 102 De Leon to get per-night probability scores. This would replace the occupancy-based estimate with actual probability data.

## Changes Summary

| File | Changes |
|------|---------|
| `supabase/functions/forecast-revenue/index.ts` | Add historical occupancy lookup, lead time decay function, reorder probability vs capacity ceiling logic |

## Expected Results

| Month | Before | After | Notes |
|-------|--------|-------|-------|
| Feb 2026 | $10,044 | ~$8,000-8,500 | Lead time decay + 80% occupancy |
| Mar 2026 | (check) | (check) | More time = less decay |
| Apr 2026 | (check) | (check) | Far out = minimal decay |

## Testing Plan
1. Regenerate forecast for 102 De Leon
2. Verify February shows ~$8,000-8,500 (not $10,044)
3. Check logs show "Probability adjusted" with lead time info
4. Verify months with longer lead times aren't over-penalized
5. Run `calculate-booking-probabilities` to get per-night data

