

# Make Monthly Forecasts Sum to Year-End P50

## Problem

The monthly `total_forecast_p50` values (line 1100) are simply the `blended_forecast` point estimates. The year-end P50 (line 1148) comes from a Monte Carlo simulation that:
1. Applies random noise (±10-30%) to each month's `blended_forecast`
2. Takes `max(on_books, simulated)` per month per iteration -- this inflates the total
3. Applies a `forecastFloor` to the result
4. Takes the median of 1000 simulated annual totals

These two approaches produce different numbers by design. The sum of monthly point estimates will almost always be lower than the simulation P50 because the `max(on_books, ...)` floor and the forecast floor both push the simulation upward.

## Solution: Distribute Simulation Results Back to Months

After running the Monte Carlo simulation, scale each month's P50/P25/P75 proportionally so they sum exactly to the year-end simulation percentiles.

## File: `supabase/functions/forecast-revenue/index.ts`

### Change: After simulation results (after line 1248), redistribute to monthly forecasts

After `simResults` is computed, calculate a scaling factor:

```
scalingFactor = simResults.p50 / sum(monthly blended_forecasts)
```

Then update each month's `total_forecast_p50`, `total_forecast_p25`, and `total_forecast_p75` using that ratio:

```typescript
// After line 1248 (simulation results logged)

// Redistribute simulation percentiles to monthly forecasts proportionally
const monthlyBlendedSum = monthlyForecasts.reduce((s, f) => s + f.blended_forecast, 0);

if (monthlyBlendedSum > 0) {
  const p50Scale = simResults.p50 / monthlyBlendedSum;
  const p25Scale = simResults.p25 / monthlyBlendedSum;
  const p75Scale = simResults.p75 / monthlyBlendedSum;

  for (const forecast of monthlyForecasts) {
    const share = forecast.blended_forecast / monthlyBlendedSum;
    forecast.total_forecast_p50 = simResults.p50 * share;
    forecast.total_forecast_p25 = simResults.p25 * share;
    forecast.total_forecast_p75 = simResults.p75 * share;
  }
}
```

This ensures:
- `sum(monthly P50) === year-end P50` exactly
- Each month's relative weight is preserved (a month that was 15% of the blended total stays 15% of the P50)
- The monthly P50 still respects the Monte Carlo simulation's floor logic and variance
- No changes to the simulation itself or the blended forecast logic

### Lines affected
- Remove the naive ±15% bands from `forecastEnhanced` return (lines 1100-1102): the P25/P75 values will now come from the redistribution
- Add redistribution block after line 1248

No database changes needed.

