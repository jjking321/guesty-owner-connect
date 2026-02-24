

# Tax Report: Change "Total Revenue" to Host Payout + Add Tax Column

## What Changes

The tax report currently shows the proportional tax amount (5/12 or 7/12 of `tax_amount`) as "Total Revenue." This is incorrect -- "Total Revenue" should be the actual host payout, and the calculated tax amounts should be in a separate column.

## Changes to `src/components/TaxReportGenerator.tsx`

### 1. Update the reservation query
Add `host_payout` to the select fields (currently only fetches `tax_amount`).

### 2. Update the ReportRow interface
- Rename `totalRevenue` to `totalPayout` (holds sum of `host_payout`)
- Add `taxAmount` field (holds the calculated 5/12 or 7/12 of `tax_amount`)

### 3. Update the report generation logic
- Sum `host_payout` per provider group for the "Total Payout" column
- Sum `tax_amount * multiplier` per provider group for the tax column (same logic as current "Total Revenue")

### 4. Update the table display
- "Total Revenue" column header becomes "Total Payout"
- Add a new column: "County Tax" on the county tab, "State Tax" on the state tab
- Both columns show in the totals row
- "Allowable Deductions" column stays as-is

### 5. Update the CSV export
- Add "Total Payout" column with `host_payout` sums
- Add the relevant tax column ("County Tax" or "State Tax")
- Keep existing columns (Period, Permit Number, Property Address, Provider, Allowable Deductions)

## Column Order (final)

| Period | Permit # | Property Address | Provider | Total Payout | County/State Tax | Allowable Deductions |

## Files Modified
- `src/components/TaxReportGenerator.tsx` -- single file change

