

# Remove Calculated Tax from Behalf Rows and Deduction Rows

## Problem
The "Calculated" tax column currently shows values for behalf-platform rows and for rows with allowable deductions. This is incorrect because:
1. Behalf platforms (e.g., Airbnb) already collect and remit tax -- there is nothing to calculate separately.
2. Allowable deductions represent tax-exempt reservations -- calculating tax on them defeats the purpose.

## File: `src/components/TaxReportGenerator.tsx`

### Changes

**Grouped rows (lines 238-262):** Set `taxAmountCalc: null` on the behalfPlatforms row. On the "other" row, set `taxAmountCalc: null` when there are allowable deductions (`totalExempt > 0`).

**Ungrouped rows (lines 279-301):** Same logic -- `taxAmountCalc: null` for behalfPlatforms rows, and `taxAmountCalc: null` on "other" rows when `data.exemptTotal > 0`.

Specifically, 4 lines change from populated values to `null`:
- Line 246: `taxAmountCalc: null` (grouped behalf)
- Line 259: `taxAmountCalc: (anyOther && !totalExempt) ? totalOtherTaxCalc : null` (grouped other)
- Line 287: `taxAmountCalc: null` (ungrouped behalf)
- Line 299: `taxAmountCalc: (data.hasOther && !data.exemptTotal) ? data.otherTaxCalc : null` (ungrouped other)

No database changes needed.

