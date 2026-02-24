

# Tax Template Fill Wizard

## Overview
Add a new "Template Fill" tab to the Tax Report page. The user uploads a blank XLSX template (like the Brevard Tourism Tax form), the system matches each row by permit number, fills in Total Revenue and Allowable Deductions from reservation data, previews the result, and lets the user download the completed XLSX.

## Template Format (from uploaded file)
Columns: **Period | Permit Number | Property Address | Provider | Total Revenue | Allowable Deductions**

- Each permit has two rows: one for `behalfPlatforms`, one for `other`
- The Period column (e.g. "January 2026") determines which month's data to pull
- Total Revenue and Allowable Deductions are left blank -- the system fills these in

## User Workflow

```text
1. Upload XLSX template
        |
2. System parses rows, extracts period & permit numbers
        |
3. System matches permits to listings via listing_tax_settings
        |
4. System calculates revenue & deductions from reservations
        |
5. Preview filled table (with match status indicators)
        |
6. Download completed XLSX
```

## How Matching Works

1. Parse each row's Permit Number from the template
2. Look up `listing_tax_settings` rows where `permit_number` matches
3. For tax groups: if multiple listings share the same permit (via `tax_group_id`), aggregate their revenue
4. For ungrouped listings: direct 1:1 match
5. Pull reservations for the period indicated in the template, split by behalfPlatforms vs other
6. Fill `Total Revenue` = sum of `host_payout` for matching provider type
7. Fill `Allowable Deductions` = tax-exempt revenue (manual bookings with no tax) on the "other" row only

## Unmatched Permits
- Rows where the permit number doesn't match any listing will be highlighted in yellow
- Their revenue columns will remain empty
- A summary badge shows "X of Y permits matched"

## Technical Details

### New dependency
- `xlsx` (SheetJS) -- for reading and writing XLSX files client-side

### New component: `src/components/TaxTemplateFill.tsx`
- File upload input (accepts `.xlsx`, `.xls`)
- On upload: parse with SheetJS, extract rows
- Detect period from the first row's Period column (parse month/year)
- Fetch reservation data for that period (reuses the same query logic as `TaxReportGenerator`)
- Build a lookup map: permit_number -> { behalfPayout, otherPayout, exemptTotal }
  - For grouped permits (tax groups): aggregate all child listings
  - For ungrouped: direct lookup
- Fill in each template row's Total Revenue and Allowable Deductions
- Show preview table with color-coded match status
- "Download Filled Template" button: writes back to XLSX preserving the original structure

### Changes to `src/pages/TaxReport.tsx`
- Add a new tab: "Template Fill" after Settings
- Render `<TaxTemplateFill />` in that tab

### Data flow (all client-side, no new backend needed)
- Queries used: `listings`, `listing_tax_settings`, `tax_groups`, `organization_tax_settings`, `reservations` (same as TaxReportGenerator)
- Matching key: `permit_number` from template row matched against `listing_tax_settings.permit_number` and `tax_groups.permit_number`
- Period detection: parsed from the "Period" column text (e.g. "January 2026" -> month 1, year 2026)

