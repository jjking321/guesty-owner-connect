## Problem

The Reports forecast metric (`forecast_p50`) shows raw model output for every month in the range, including months that have already ended. The Portfolio view's Revenue Forecast component swaps past-month forecasts with realized actuals (from `reservation_nights`) so the displayed numbers reflect "what actually happened + what's still projected." This is why a report covering YTD or full-year ranges doesn't match Portfolio.

Reference: `src/components/RevenueForecast.tsx` lines 348–367 and 481–483 — for any month whose start is before the current month, the displayed value is the actual revenue, not `total_forecast_p50`.

## Fix

Apply the same past-month substitution inside `src/lib/reports/dataFetcher.ts` for the `forecast_p50` metric, in both code paths:

### 1. Flat path (`fetchModuleData`, ~line 285)

After reading `monthly_forecasts` rows and before `aggregateGenericForecast`:

- Determine `currentMonthStart = startOfMonth(new Date())`.
- Collect the set of past months (months whose date < currentMonthStart) that fall inside `range`.
- Fetch `reservation_nights` for `listingIds` between the start of the earliest past month and the end of the latest past month (clamped to `range`).
- Aggregate actual revenue per (listing_id, YYYY-MM) bucket.
- For every `(listing_id, target_month)` pair where the month is in the past, replace `forecast_p50` with the matching actual revenue (0 if no nights).

This way KPI / table / chart aggregations downstream see actuals for past months and forecasts for current+future months, identical to Portfolio.

### 2. Pivot path (`buildPivotData`, ~line 1089)

Same logic, but operate on the per-month JSONB iteration before `revByCell.set(...)`:

- Precompute the past-month actuals map keyed by `(listing_id, YYYY-MM)` using one `fetchReservationNights` call covering the past-month sub-range.
- When processing each monthly forecast entry, if its month is before `currentMonthStart`, replace `v` with the actual revenue for that listing+month.

### 3. Comparisons stay correct

- `actual_revenue` compare: unchanged — it already aggregates `reservation_nights` for the same range. After the swap, the primary equals the compare for past months (delta = 0 there), and only future months drive the delta, which is the correct behavior.
- `goal`, `compset`, time-shifted compares: unchanged.

### 4. No UI changes

`DataTable`, `KpiCard`, `LineChartModule`, `BarChartModule` already render whatever values come back. No type changes.

## Out of scope

- Forecast band (P10/P90) — not surfaced in reports today.
- Non-`forecast_p50` metrics.
- Any change to `revenue_forecasts` generation.

## Verification

- Report KPI with metric = Forecast (P50), date range = YTD or full current year → total matches Portfolio "Projected End-of-Year Revenue" for the same scope.
- Report Table broken down by Month → past months show actuals, future months show model P50.
- Report Pivot (Listing × Month) → same per-cell substitution.
- Compare = Actual Revenue → past-month deltas are 0; future months show forecast vs OTB.
