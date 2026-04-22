

# Add CSV export to Performance Metrics Monthly Breakdown

Add an "Export CSV" button to the Monthly Breakdown table on the Property Detail page (`/listings/:id`), mirroring the pattern already used by the Pacing Report.

## Changes

**File: `src/pages/PropertyDetail.tsx`**

1. **Add `handleExportMonthlyCSV` handler** (next to the `monthlyMetrics` `useMemo` around line 583). It builds a CSV from `monthlyMetrics` with columns: `Month, Revenue, Nights, Occupancy %, ADR, RevPAR`, blob-downloads it as `monthly-breakdown-{listing-nickname}-{yyyy-MM-dd}.csv`. Uses the same `Blob` + `URL.createObjectURL` + anchor-click pattern as `handleExportPacingCSV` in `PacingReport.tsx`.

2. **Add "Export CSV" button** in the Collapsible header row at line 923-933. Restructure the trigger area so the collapsible toggle stays on the left and a small `Button variant="outline" size="sm"` with the `Download` icon sits on the right. Clicking the button calls `handleExportMonthlyCSV` and uses `e.stopPropagation()` so it doesn't toggle the collapsible.

3. **Import `Download` icon** from `lucide-react` (the file already imports other lucide icons, just add `Download` to the existing import).

## Output format (matches Pacing CSV style)

```
Month,Revenue,Nights,Occupancy %,ADR,RevPAR
Jan 2025,12500.00,18,58.1,694.44,403.23
Feb 2025,...
```

Numeric values are written without `$` or thousand separators so the CSV opens cleanly in Excel/Sheets.

## Out of scope

- No PDF export (Pacing has one but the user only asked for CSV).
- No backend changes — export is fully client-side from the already-computed `monthlyMetrics` array.

