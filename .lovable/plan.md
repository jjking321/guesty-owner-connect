

# Rename "Total Payout" to "Subtotal"

Since the data source is now `sub_total` (Guesty's `money.subTotal`), the display labels should reflect this.

## Changes in `src/components/TaxReportGenerator.tsx`

1. **Table header** (line 395): Change `"Total Payout"` to `"Subtotal"`
2. **CSV export** (line 302): Change `"Total Payout"` to `"Subtotal"`
3. **Summary card** (line 336): Change `"Total Revenue"` to `"Total Subtotal"` (or keep as "Total Revenue" if preferred — this is the aggregate)

## Files to edit
- `src/components/TaxReportGenerator.tsx` (3 label changes)

