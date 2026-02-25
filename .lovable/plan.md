

# Fix Calculated Tax to Exclude Exempt Reservations

## Problem
The "Calculated" tax column computes `sub_total * 5%` (or 7%) across **all** "other" reservations, including tax-exempt ones. The correct formula is:

```text
Calculated Tax = (Other Subtotal − Allowable Deductions) × flat rate
```

Currently the code sums `sub_total * flatRate` per reservation in `sumCalcTax`, which includes exempt reservations in the total. And when deductions exist, it nullifies the value entirely instead of subtracting.

## File: `src/components/TaxReportGenerator.tsx`

### Change 1: Compute calculated tax as `(otherPayout - exemptTotal) * flatRate`

Instead of accumulating `sub_total * flatRate` per reservation via `sumCalcTax`, the calculated tax should simply be:

```typescript
otherTaxCalc: (otherPayout - exemptTotal) * flatRate
```

This is cleaner and matches the expected formula. The `sumCalcTax` helper can be removed or kept for behalf rows only.

### Change 2: Always show calculated tax on "other" rows (remove the null-when-deductions logic)

Since the calculation now properly subtracts deductions, there is no reason to hide the value when deductions exist. The four locations that build rows will set:

- **Behalf rows**: `taxAmountCalc: null` (unchanged -- platforms handle tax)
- **Other rows (grouped)**: `taxAmountCalc: anyOther ? (totalOtherPayout - totalExempt) * flatRate : null`
- **Other rows (ungrouped)**: `taxAmountCalc: data.hasOther ? (data.otherPayout - data.exemptTotal) * flatRate : null`

### Summary of line changes

- Lines ~186-192: Update `otherTaxCalc` computation in `computeListingData` return
- Lines ~256: Update grouped "other" row `taxAmountCalc`
- Lines ~296: Update ungrouped "other" row `taxAmountCalc`

No database changes needed.

