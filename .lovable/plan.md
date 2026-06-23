## Goal

Enable the "Compare to" feature for Table widgets that use both Rows × Columns breakdowns (pivot mode). Each pivot cell will show the metric value with the comparison value (and delta %) stacked underneath.

## What changes

### 1. `src/components/reports/ModuleConfigForm.tsx`
- Remove the rule that hides "Compare to" when `breakdown2` is set. Compare is allowed in pivot mode for all existing compare keys.

### 2. `src/lib/reports/types.ts`
- Extend `ModuleData.pivot.rows[i].values` to also carry a compare value per cell:
  - Change row shape to `{ key, values: Record<string, { value: number; compareValue?: number }>, rowTotal, rowCompareTotal? }`
  - Add `pivot.columnCompareTotals?: Record<string, number>` and `pivot.grandCompareTotal?: number`
  - Add `pivot.compareLabel?: string`

### 3. `src/lib/reports/dataFetcher.ts` — `buildPivotData` + `assemblePivot`
Add a compare pass for all valid compare keys, mirroring the per-cell aggregation:

- **`last_year` / `two_years_ago` / `previous_period` / `last_30_days` / `last_90_days` / `last_month`** — call `resolveCompareRange`, fetch reservation nights for the shifted range, bucket via `pivotKeyPairs`. For yearly month-axis shifts, shift each prev night's date forward N years so labels align. For non-yearly shifts on a month axis, align by ordinal position to the current month list.
- **`actual_revenue`** (forecast only) — fetch reservation nights for the same range, bucket per cell.
- **`goal`** — fetch goals for the range, bucket per cell.
- **`compset`** — reuse existing `applyCompsetCompare` style: pull pre-calculated compset averages, bucket by cell (only meaningful when month is on one axis — fall back to per-row total otherwise, matching legacy behavior).

Compute per-cell compare values using the same derivation rules as the primary (rev/nights/listings → revenue/nights/occupancy/adr/revpar). Compute row, column, and grand compare totals using the same aggregation logic already in `assemblePivot` (just on the compare maps).

Pass the compare maps + `compareLabel` into `assemblePivot`, which threads them onto each cell and onto the totals.

### 4. `src/components/reports/modules/DataTable.tsx`
Update the pivot render branch:

- Each data cell renders: main value on top line, and beneath it muted small text: `compareValue` and `(±X.X%)` colored green/red.
- Row Total cell: same stacked treatment using `rowCompareTotal`.
- Column Totals row: same stacked treatment using `columnCompareTotals[c]` and `grandCompareTotal`.
- Header label for compare uses `pivot.compareLabel` (shown once in a small subheader caption, e.g. "vs Last year" under the title).
- CSV export: when compare is present, double the column count — for each column emit `<col>` and `<col> (vs <compareLabel>)`. Add matching paired totals.

No changes to KpiCard / LineChart / BarChart (they already use the flat rows[] which `assemblePivot` continues to populate with row totals).

## Out of scope

- Date-range pickers, scope picker, breakdown selectors — unchanged.
- Non-pivot legacy table render — unchanged.
- Compare in line/bar charts in pivot mode — N/A; only Table uses pivot today.

## Verification

- Table widget, metric = Revenue, Rows = Listing, Columns = Month, Compare = Last year:
  - Each cell shows current revenue with prior-year revenue + delta % below.
  - Row Total column and Total row both show stacked comparisons.
- Same with metric = Forecast (P50), Compare = Actual Revenue / Goal / Last year — all populate per-cell compare.
- Metric = Occupancy/ADR/RevPAR — compare cell uses correctly-derived rate, not raw revenue.
- CSV export contains paired columns when compare is active.
