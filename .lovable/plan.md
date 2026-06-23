## Plan

Update the revenue forecast calculation so each future month is anchored to the most reliable monthly baseline instead of being dragged down by probability/capacity adjustments.

### What will change

1. **Monthly baseline selection**
   - For each forecast month, use that same month from the prior year as the primary baseline.
   - If that prior-year month has no usable revenue, fall back to compset monthly data for that month.
   - If neither exists, keep the existing annual-average fallback.

2. **Pacing adjustment**
   - Keep the current same-store pacing/velocity factor, but apply it to the monthly baseline as the core forecast signal.
   - This means September with strong prior-year September revenue will forecast around prior-year September revenue adjusted by this year’s actual pace, instead of collapsing to a few hundred dollars.

3. **Probability and compset data become modifiers, not hard caps**
   - Booking probability, compset occupancy, lead-time decay, and gap quality should adjust expected remaining revenue, but should not override the prior-year/pacing baseline unless capacity truly makes the number impossible.
   - Keep the capacity ceiling as a real maximum, but avoid using low probability-adjusted values as a hard cap against the historical baseline.

4. **Past and current month handling**
   - Past months continue to show actual realized revenue.
   - Current month keeps actual-to-date plus on-books/remaining-month projection.
   - Future months show the improved estimate.

5. **Monthly output transparency**
   - Add stored fields to monthly forecast rows such as baseline source, pacing-adjusted forecast, compset fallback flag, and whether capacity constrained the result.
   - Keep the existing UI table compatible while allowing future debugging of why a month got its forecast.

### Technical details

- Main change is in `supabase/functions/forecast-revenue/index.ts` inside `forecastEnhanced()`.
- Replace the current behavior where `probabilityAdjustedForecast` can cap `blendedForecast` below the historical monthly baseline.
- Compute a future-month forecast roughly as:

```text
monthly baseline = prior-year same month actual
if missing: compset same month estimate
if missing: annual average

pacing forecast = monthly baseline × clipped current-year velocity
probability forecast = revenue on books + expected remaining revenue
final forecast = max(on books, weighted blend biased toward pacing forecast)
final forecast = min(final forecast, true capacity ceiling when available)
```

- No schema migration is required because monthly forecast data is stored as JSON.
- After code changes, deploy the updated forecast edge function so Refresh / regeneration uses the new logic.