

# Add Calculated Tax Column Alongside Actual Collected

## Overview
Add a new "Calculated" tax column next to the existing "Actual Collected" tax column. The existing column shows the proportional split (5/12 or 7/12 of `tax_amount`). The new column shows a flat percentage of `sub_total` (5% for county, 7% for state).

## File: `src/components/TaxReportGenerator.tsx`

### 1. Update `ReportRow` interface (line 13-23)
Add `taxAmountCalc: number | null` field for the calculated (flat %) value.

### 2. Update `computeListingData` (lines 166-186)
Add per-reservation accumulation for calculated tax:
- County: sum of `sub_total * 0.05` per reservation
- State: sum of `sub_total * 0.07` per reservation

Return new fields: `behalfTaxCalc`, `otherTaxCalc`.

### 3. Update grouped row building (lines 206-246)
- Track `totalBehalfTaxCalc` and `totalOtherTaxCalc` accumulators
- Populate `taxAmountCalc` on each row

### 4. Update ungrouped row building (lines 257-283)
- Populate `taxAmountCalc` from `computeListingData` results

### 5. Rename existing tax column header (line 38 + table header)
- Rename from "County Tax" / "State Tax" to "County Tax (Collected)" / "State Tax (Collected)"
- New column header: "County Tax (Calculated)" / "State Tax (Calculated)"

### 6. Add summary totals (lines 291-294)
- Add `taxCalcTotal` for the new calculated column

### 7. Update summary cards
- Add a card showing the calculated total alongside the collected total

### 8. Update table columns
- Add new `<TableHead>` and `<TableCell>` for the calculated amount

### 9. Update CSV export (lines 296-306)
- Add the calculated column to the CSV output

### No database changes needed.

