

# Restructure Tax Report to Match Filing Format

## What's Changing

The current report doesn't match your actual filing CSV. Here's what needs to be fixed:

### 1. "Total Revenue" = Total Tax Collected (not accommodation revenue)
The CSV column labeled "Total Revenue" actually contains the **tax amount collected**, not the property revenue. The current code shows `fare_accommodation_adjusted` in that column -- it needs to show the `tax_amount` instead.

### 2. Separate County and State Tabs
Instead of one combined report with county/state columns, the filing requires **two separate reports** -- one for County (5%) and one for State (7%). Each produces its own CSV with the same format:
- `Period, Permit Number, Property Address, Provider, Total Revenue, Allowable Deductions`

The "Total Revenue" in the County tab = `tax_amount * (5/12)`, and in the State tab = `tax_amount * (7/12)`.

### 3. Every Property Gets Two Rows (Even if Empty)
The CSV always shows two rows per property: one for `behalfPlatforms` and one for `other`. Even if there are no reservations, the rows appear with blank values. This means we need to iterate over **all listings with tax settings**, not just those with reservations.

### 4. Provider Labels
Use `behalfPlatforms` and `other` as the provider values (matching the CSV exactly), not "Behalf Platforms" and "Other".

### 5. Period Column
Add a "Period" column formatted as "January 2026" etc.

### 6. Allowable Deductions Column
Include this column (can be blank/0 for now).

## Page Layout Changes

The Report tab currently shows one table. It will be replaced with sub-tabs:

- **County** -- County tax report (5/12 of tax_amount)
- **State** -- State tax report (7/12 of tax_amount)

Each sub-tab shows the same table format and has its own "Download CSV" button.

## Technical Details

### Files Modified

**`src/components/TaxReportGenerator.tsx`** -- Major rewrite:
- Change `ReportRow` interface: remove `countyTax`, `stateTax`, `totalTax` columns; the single "Total Revenue" value will be the tax portion (county or state) for the active tab
- Add a `taxType` prop or internal tab state to toggle between "county" and "state"
- Generate rows for ALL listings that have tax settings (not just those with reservations), always producing both `behalfPlatforms` and `other` rows per listing
- For county: `totalRevenue = sumTaxAmount * (5/12)`
- For state: `totalRevenue = sumTaxAmount * (7/12)`
- CSV columns: `Period, Permit Number, Property Address, Provider, Total Revenue, Allowable Deductions`
- Sort by permit number (matching CSV order)

**`src/pages/TaxReport.tsx`** -- Update tabs:
- Replace the single "Report" tab with "County" and "State" tabs
- Each renders `TaxReportGenerator` with a `taxType` prop ("county" or "state")
- Keep "Tax Exempt" and "Settings" tabs as-is

### Row Generation Logic
```
for each listing with tax_settings:
  - behalfPlatforms row: sum tax_amount where source is in behalf_platforms
  - other row: sum tax_amount where source is NOT in behalf_platforms
  - apply county (5/12) or state (7/12) multiplier to get "Total Revenue"
  - if no reservations exist, leave Total Revenue blank (not 0)
```

### CSV Export Format
```
Period,Permit Number,Property Address,Provider,Total Revenue,Allowable Deductions
January 2026,25-001764,241 S BREVARD AVE COCOA BEACH FL 32931,behalfPlatforms,8598.88,
January 2026,25-001764,241 S BREVARD AVE COCOA BEACH FL 32931,other,0,
```

The filename will include the tax type: `Brevard_County_Tax_2026-01.csv` or `Brevard_State_Tax_2026-01.csv`.
