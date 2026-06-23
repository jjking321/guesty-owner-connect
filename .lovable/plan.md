## Add CSV export for forecast

Add an **Export CSV** button to the `RevenueForecast` component (`src/components/RevenueForecast.tsx`), placed next to the "Monthly Forecast Breakdown" heading.

### Behavior
- Exports one row per month from `forecast.monthlyForecasts`, using the same logic the table renders so values match exactly.
- Columns:
  - Month (e.g. `2026-09`)
  - Period (Past / Current / Future)
  - Actual
  - On Books
  - Forecast
  - Pace %
  - Probability %
  - Compset Demand
- Includes a final **Total** row summing Actual / On Books / Forecast.
- Filename: `forecast-<listingId>-<YYYYMMDD>.csv`.
- Currency as plain numbers (no `$`/commas) for spreadsheet friendliness; percentages as decimals (e.g. `0.95`).

### Implementation notes
- Reuse the existing `downloadCsv` helper from `src/lib/reports/format.ts` to stay consistent with other CSV exports.
- Button uses shadcn `Button` (`variant="outline" size="sm"`) with the `Download` icon — same pattern as `DataTable.tsx`.
- No backend or schema changes.

### Scope check
Only the listing-level forecast view has a CSV export right now. Do you also want one on:
- the **all-listings / portfolio forecast** view, and/or
- the **group forecast** view?

If yes, I'll add the same button there in the same change.