

# Add table view and CSV export to Performance Metrics chart

Add a "View as Table" toggle and an "Export CSV" button to each of the four metric tabs (Revenue, Occupancy, RevPAR, ADR) inside the **Performance Metrics** card on the Property Detail page.

## Where

**File: `src/components/GoalsComparison.tsx`** — this is the "Performance Metrics" component shown on `/listings/:id` with the Revenue / Occupancy / RevPAR / ADR sub-tabs.

## Changes

### 1. View toggle + export button (header row)
In the existing metric-selector row (around line 834) add two controls aligned to the right:
- A small `Tabs` (or two icon buttons) toggling between **Chart** and **Table** view, stored in new state `viewMode: 'chart' | 'table'`.
- An **Export CSV** `Button` (`variant="outline"`, `size="sm"`, `Download` icon from `lucide-react`) that exports the *currently active metric's* dataset.

Both controls re-use the active metric and the currently selected year, so toggling tabs swaps the table/CSV contents accordingly.

### 2. Table renderer
Add a `renderMetricTable()` helper that picks columns based on `activeMetric`:

- **Revenue (Monthly view)** — Month · Actual · Goal · Last Year · Forecast P25 · Forecast P50 · Forecast P75 · Compset Avg  
  *(columns for Goal / Forecast / Compset / Last Year only included when their respective toggle is on; otherwise omitted to stay consistent with the chart)*
- **Revenue (Cumulative view)** — same columns, cumulative values
- **Occupancy** — Month · Current Year (%) · Last Year (%) · Compset Avg (%)
- **RevPAR** — Month · Current Year ($) · Last Year ($) · Compset Avg ($)
- **ADR** — Month · Current Year ($) · Last Year ($) · Compset Avg ($)

Rendered with the existing `Table` primitives (`@/components/ui/table`) inside the same `CardContent`, replacing the chart when `viewMode === 'table'`. The "Show Goals / Forecast / Compset / Compare Last Year" checkboxes stay visible and continue to control which columns appear, so chart and table behave identically.

### 3. CSV export handler
Add `handleExportCSV()` that:
- Builds headers + rows from the same data the table renders (so what you see is what you export).
- Formats: occupancy as `xx.x` (no `%`), currency as `xxxx.xx` (no `$`, no thousands separators), matching the Pacing/Monthly Breakdown CSV style already in the project.
- Filename: `performance-{metric}-{year}-{listing-or-portfolio}-{yyyy-MM-dd}.csv` (e.g. `performance-revenue-2026-cozy-cabin-2026-04-22.csv`). For group/owner views (no `listingId`) it falls back to `portfolio`.
- Uses the same `Blob` + `URL.createObjectURL` + anchor-click pattern already used by `handleExportMonthlyCSV` in `PropertyDetail.tsx` and `handleExportPacingCSV` in `PacingReport.tsx`.

### 4. Imports
Add `Download` to the existing `lucide-react` import and add `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `@/components/ui/table`.

## Out of scope
- No backend changes — purely client-side from data already computed in the component.
- No PDF export.
- The existing Monthly Breakdown table on the same page (separate component) already has CSV export from a prior change and is unchanged.

## Technical notes
- `viewMode` is a single piece of state shared across all 4 metric tabs, so users who prefer the table see it everywhere.
- For the Revenue tab, the toggle respects the inner Monthly/Cumulative sub-tab — table and CSV pull from `monthlyData` or `cumulativeData` accordingly.
- Listing nickname for the filename is not currently available inside `GoalsComparison`; we'll slugify `listingId` (or pass an optional `listingNickname` prop from `PropertyDetail.tsx` — preferred, one-line addition where the component is rendered).

