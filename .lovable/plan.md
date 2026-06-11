## Goal

When a report module's metric is **Forecast (P50)**, default the "Compare to" selector to **Actual Revenue** and add that as a real comparison option. Users can still override to Goal / Last Year / etc.

Today the forecast path returns early before compare logic runs, so no comparison renders for forecast modules at all.

## Changes

### 1. `src/lib/reports/types.ts`
- Add `'actual_revenue'` to `CompareKey`.
- Add `actual_revenue: 'Actual Revenue'` to `COMPARE_LABELS`.

### 2. `src/lib/reports/dataFetcher.ts` — forecast path (around lines 233–272)
After computing the forecast `rows` / `total`, when `module.compare === 'actual_revenue'`:
- Fetch `reservation_nights` for the same `listingIds` and resolved date range (reuse `fetchReservationNights`).
- Sum `revenue_allocation` into the same bucket keys (month / listing / owner / group) the forecast already uses.
- Set `compareTotal` to the actual revenue sum and `compareLabel` to `'Actual Revenue'`.
- Populate `row.compareValue` per bucket.

This makes the existing KPI / line / bar / table renderers display forecast vs actual with no further changes.

### 3. `src/components/reports/ModuleConfigForm.tsx`
- In the metric `<Select onValueChange>`: when the new metric is `forecast_p50` and current `module.compare` is `null` or one of the date-shift compares that doesn't apply to forecasts, set `compare: 'actual_revenue'` in the same `update()` call. Keep the user's choice if they already picked Goal or Actual Revenue.
- Add `<SelectItem value="actual_revenue">Actual Revenue (forecast only)</SelectItem>` to the Compare dropdown.
- Mirror the existing "goal" hint: if `compare === 'actual_revenue'` and `metric !== 'forecast_p50'`, show a small muted note that it only applies to forecasts.

### 4. New-module default (`ReportBuilder.tsx` → `newModule()`)
Leave unchanged — the auto-select fires when the user switches the metric to forecast, which is the requested behavior.

## Out of scope
- No database/schema changes.
- No changes to KPI dashboard, forecast generation, or other report metrics.
