## Goal
For the Monthly Forecast Breakdown on the property detail page, replace the model's forecast with the realized actual for past months, so the annual forecast reflects what's still possible (not overstated history).

## Changes

**File: `src/components/RevenueForecast.tsx`**

1. **Forecast column (line 479-481)** — for past months, render the `actualForMonth` value instead of `m.total_forecast_p50`. Current and future months unchanged.
   ```text
   isPastMonth → show actualForMonth (or "-" if 0)
   else        → show m.total_forecast_p50 / blended_forecast
   ```

2. **Annual total forecast (line 372 — the big "$X" P50 number)** — recompute on the client as:
   ```text
   sum(actualForMonth for past months) + sum(m.total_forecast_p50 for current + future months)
   ```
   Apply the same logic to the P10/P90 confidence band (line 375-376) by replacing past-month P10/P90 with actuals.

3. **Probability of Hitting Goal donut** — leave as-is for this change (it's driven by `forecast.goalProbabilities` from the backend). Note: the donut may slightly disagree with the new client-recomputed total; out of scope unless you want it updated too.

## Out of scope
- No edge-function / `revenue_forecasts` table changes. This is a presentation-only fix; stored monthly_forecasts remain untouched.
- "On Books", "Pace", "Prob %", "Demand" columns unchanged.

## Open question
Should the Probability of Hitting Goal % also be recomputed from the new past-actual-anchored total, or stay tied to the backend model output?