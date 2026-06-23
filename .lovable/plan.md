## Goal

Make the Forecast (P50) metric in the Report Builder display correctly and support the same comparison options as the Revenue metric — so a forecast can be lined up against last year's actuals, the previous period, current on-the-books revenue, goals, or compset averages.

## What's broken today

In `src/lib/reports/dataFetcher.ts`:

1. **Month order is alphabetical.** `aggregateGenericForecast` sorts bucket keys with `localeCompare`, so "Apr 2026" comes before "Jan 2026" in tables and charts.
2. **Most "Compare to" options are silently ignored** for `forecast_p50`. Only `actual_revenue` and `compset` attach compare values; `last_year`, `two_years_ago`, `previous_period`, `last_30_days`, `last_90_days`, `last_month`, and `goal` are dropped on the floor — the user picks them but nothing shows up in the chart/table.
3. **Owner / Group breakdowns are wrong** for the forecast metric. `aggregateGenericForecast` only branches on `listing` vs everything-else-treated-as-month, so picking "By owner" or "By group" silently buckets by month and the compare values never line up.

## Fix

All changes are in `src/lib/reports/dataFetcher.ts`. No schema or UI changes.

### 1. Chronological month sort

Replace `localeCompare` in `aggregateGenericForecast` with a parse-then-compare sort that orders by actual date when the breakdown is month, and alphabetically otherwise.

### 2. Real owner / group breakdown support for forecast rows

`aggregateGenericForecast` becomes async (or takes pre-resolved helpers) so it can use the existing `fetchOwnerNames` + `fetchGroupsForListings` + `bucketKey` helpers — same pattern revenue already uses. For each forecast row we synthesize a date from `target_month` (mid-month) and call `bucketKey(date, listing_id, breakdown, listingsById, ownerNames, groupsForListing)`, expanding to multiple buckets when a listing belongs to multiple groups. Sort:
- month: chronological
- listing / owner / group: alphabetical

### 3. Wire up all the missing compare modes for forecast

Inside the `if (module.metric === 'forecast_p50')` block, after the forecast data is aggregated:

- **`last_year` / `two_years_ago` / `previous_period` / `last_30_days` / `last_90_days` / `last_month`** — resolve the shifted range via the existing `resolveCompareRange`, fetch `reservation_nights` for that shifted range, then attach per-bucket and total compare values:
  - month breakdown with a yearly shift (`last_year`, `two_years_ago`): shift each prev night's date forward N years and re-bucket so "Jan 2026" lines up with Jan 2025/2024 nights.
  - month breakdown with non-yearly shifts (`previous_period`, `last_30_days`, etc.): bucket prev nights by their own months, then align by ordinal position to the current bucket list (same approach revenue already uses).
  - listing / owner / group breakdowns: bucket prev nights with the same `bucketKey(...)` helper so labels match.
  - `compareTotal` = sum of prev revenue across the shifted range. `compareLabel` = `COMPARE_LABELS[module.compare]`.
- **`goal`** — reuse `fetchGoals` for the current range, bucket goal_revenue by month (or by listing/owner/group via the same helper), attach per-bucket `compareValue` and a `compareTotal`. Label "Goal". Same restriction the UI already shows (Goal only meaningful when buckets align — match revenue's behavior for non-month breakdowns).
- **`actual_revenue`** (already works) — keep, but route it through the same shared helper so owner/group buckets line up correctly with the fixed bucket keys above.
- **`compset`** — keep using `applyCompsetCompare`, unchanged.

### 4. Refactor a small shared helper

Extract the existing "bucket reservation nights into a Map<bucketKey, number> with owner/group helpers" loop into a single private helper used by both the revenue path and the new forecast-compare path. Keeps the new code from duplicating ~40 lines.

## Files touched

- `src/lib/reports/dataFetcher.ts` — only file changed.

## Verification

- Pick a listing/group with a forecast, set metric = Forecast (P50), range = "Rest of year" or "Next 12 months", breakdown = By month:
  - Months render in calendar order (Jan, Feb, …) instead of alphabetical.
  - Compare = Last year → each future month shows prior-year actual for the same month, and a compare total appears.
  - Compare = Previous period → ordinal-aligned prior values appear per bucket.
  - Compare = Actual Revenue → on-the-books values appear per bucket.
  - Compare = Goal → monthly goal appears per bucket.
- Switch breakdown to Owner and Group: rows are labeled by owner/group name, and the compare column lines up by the same label.
- KPI / Line / Bar widgets still render forecast totals correctly (the `rows[]`/`total` shape is unchanged; only sort order and added compare fields differ).

## Out of scope

- The pivot (Rows × Columns) path for forecast already exists and works; no change there.
- No changes to how forecasts are *generated* — only how they're displayed and compared in reports.