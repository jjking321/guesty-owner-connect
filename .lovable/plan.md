

# Fix Monthly Forecast Display to Use Redistributed P50 Values

## Problem

The redistribution logic in the edge function correctly updates `total_forecast_p50` on each monthly forecast object. However, the frontend (`src/components/RevenueForecast.tsx`, line 483-484) displays:

```typescript
m.blended_forecast || m.total_forecast_p50
```

Since `blended_forecast` is always a non-zero number (the raw point estimate before redistribution), it always takes precedence. The redistributed `total_forecast_p50` is never shown.

The same issue exists in `GroupDetail.tsx` (line 482) and `OwnerDetail.tsx` (line 539) which read `total_forecast_p50`, but those should be fine since they use `total_forecast_p50` directly.

## Solution

Two changes needed:

### Change 1: Frontend — Use `total_forecast_p50` instead of `blended_forecast` for display

**File: `src/components/RevenueForecast.tsx`** (lines 483-484)

Change the forecast column to prefer `total_forecast_p50` over `blended_forecast`:

```typescript
// Before
actualForMonth + (Number(m.blended_forecast || m.total_forecast_p50 || 0))
// After
actualForMonth + (Number(m.total_forecast_p50 || m.blended_forecast || 0))
```

Same swap on line 484 for future months.

### Change 2: Edge function — Also update `blended_forecast` during redistribution (belt and suspenders)

**File: `supabase/functions/forecast-revenue/index.ts`** (lines 1255-1259)

In the redistribution loop, also update `blended_forecast` so any other consumer that reads it gets the correct value:

```typescript
for (const forecast of monthlyForecasts) {
  const share = forecast.blended_forecast / monthlyBlendedSum;
  forecast.total_forecast_p50 = simResults.p50 * share;
  forecast.total_forecast_p25 = simResults.p25 * share;
  forecast.total_forecast_p75 = simResults.p75 * share;
  forecast.blended_forecast = simResults.p50 * share; // Keep in sync
}
```

This ensures both fields agree, so regardless of which one any component reads, the values will sum to the year-end P50.

No database changes needed. After deploying, re-run forecasts from the Forecast Admin page.

