

# Populate Allowable Deductions with Tax-Exempt Revenue

## Problem
The "Allowable Deductions" column in the tax report is always empty. It should show the revenue (accommodation amount) from tax-exempt bookings -- the same manual reservations with $0 tax that appear in the Tax Exempt tab.

## Solution
Query the tax-exempt reservations (manual source, tax_amount is null or 0, fare_accommodation_adjusted > 0) alongside the regular reservations, group them by listing, and sum `fare_accommodation_adjusted` per listing to populate the Allowable Deductions column.

## Technical Details

### File: `src/components/TaxReportGenerator.tsx`

1. **Add a new query** for tax-exempt reservations in the same date range, matching the TaxExemptTable logic:
   - `source = 'manual'`
   - `tax_amount IS NULL OR tax_amount = 0`
   - `fare_accommodation_adjusted > 0`
   - Same status filter: `confirmed`, `checked_in`, `checked_out`
   - Same date range (check_out between start and end)

2. **Group exempt totals by listing_id** and sum `fare_accommodation_adjusted`

3. **Populate `allowableDeductions`** in each report row with the exempt total for that listing (formatted as currency), or leave empty if none

4. **Update the ReportRow interface** to make `allowableDeductions` a `number | null` instead of `string` so it works with the currency formatter

5. **Update totals row** to include a sum of allowable deductions

6. **Update CSV export** to output the numeric deduction value

### Behavior
- The deduction amount is per-listing (not split by provider group), so it will appear on the first row for each listing (the "behalfPlatforms" row) and be empty on the "other" row to avoid double-counting
- Or alternatively, show the same value on both rows if that's preferred for the CSV format -- this is a minor detail we can adjust

