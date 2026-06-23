## Goal

Let a Table module in the Report Builder break data down by two dimensions at once (e.g. Listing × Month, Owner × Month, Group × Listing) so reports — especially the ones shared with group owners — can show a true matrix instead of a single column of buckets.

KPI, Line, and Bar widgets are unchanged in this pass.

## UX

In the Table module config:

- Rename the existing "Breakdown" field to **Rows (breakdown)**.
- Add a new optional **Columns (then by)** select, shown only when widget type is `table`. Options: `None`, `By month`, `By listing`, `By owner`, `By group`. The option matching the primary breakdown is disabled so you can't pick the same dimension twice.
- When Columns = `None`, the table renders exactly like today (single-value column).
- When Columns is set, the table becomes a pivot:

```text
                  Jan 2026   Feb 2026   Mar 2026   Total
  Cozy Cabin       $4,200     $5,100     $6,300    $15,600
  Beach House      $3,000     $3,800     $4,500    $11,300
  ...
  Total            $7,200     $8,900    $10,800    $26,900
```

- Each cell uses the module's metric and unit (currency / number / percent), formatted the same way as today.
- Column order: months are chronological; listings/owners/groups are alphabetical by label (matches existing behavior).
- The Compare-to selector is hidden when Columns is set (compare + pivot in the same widget is out of scope for this pass; we can add it later).
- CSV export from the table mirrors the on-screen pivot: first column is the row bucket, then one column per pivot column, plus a Total row and Total column.

## Data layer

`ReportModule` gains an optional `breakdown2?: BreakdownKey` field (back-compat: missing = today's behavior).

`ModuleData` gains an optional pivot shape used only when `breakdown2` is set:

- `columns: string[]` — pivot column labels in display order
- `pivotRows: Array<{ key: string; values: Record<string, number>; rowTotal: number }>`
- `columnTotals: Record<string, number>`
- `grandTotal: number`

When `breakdown2` is not set, `ModuleData` stays exactly as today (`rows`, `total`, optional compare fields). The Table component picks the render path based on whether `pivotRows` is present.

In `src/lib/reports/dataFetcher.ts`:

- Add a helper that, given a night/reservation row, returns both bucket keys (`bucketKey` already exists for one dimension — extend or call it twice).
- For the metrics that already support breakdowns (revenue, nights, occupancy, adr, revpar, forecast_p50, goal), aggregate into a `Map<rowKey, Map<colKey, number>>` instead of a single map when `breakdown2` is set.
- Derive `columns`, `pivotRows`, `columnTotals`, `grandTotal` from that map, sorted with the existing ordering rules (chronological for month, alphabetical for entity).
- Skip the compare branch entirely when `breakdown2` is set.
- Derived metrics (occupancy, ADR, RevPAR) must be computed per cell from the same numerator/denominator pairs already used today — not as an average of averages.

## Files touched

- `src/lib/reports/types.ts` — add `breakdown2` to `ReportModule`; add optional pivot fields to `ModuleData`.
- `src/components/reports/ModuleConfigForm.tsx` — rename label, add the "Columns (then by)" select for tables, disable matching option, hide Compare-to when pivot is active.
- `src/lib/reports/dataFetcher.ts` — two-dimensional aggregation path for each metric.
- `src/components/reports/modules/DataTable.tsx` — render pivot table when `pivotRows` is present; update CSV export to match.
- `src/pages/ReportBuilder.tsx` — default `breakdown2: undefined` on new modules (no other changes).

## Out of scope (call out explicitly)

- Line/Bar/KPI keep their current single-breakdown behavior.
- Compare-to is not combined with pivot in this pass.
- No DB/migration changes; `report.config` is JSON, so the new field stores transparently in existing rows.