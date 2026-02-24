

# Add/Remove Units from Tax Report

## Overview
Add a toggle on each listing in the Tax Settings tab to include or exclude it from the tax report. This gives you control over which properties appear in the County/State reports and CSV exports.

## How It Works
- A new checkbox column ("Include") appears in the Tax Settings table next to each property
- All listings default to included
- Unchecking a listing removes it from the County and State report tabs and CSV downloads
- The setting persists via the database

## Technical Details

### 1. Database Migration
Add a boolean column `excluded_from_tax` (default `false`) to the `listing_tax_settings` table. This avoids requiring a settings row for every listing just to be included -- only excluded listings need a row with the flag set.

### 2. TaxSettingsTable.tsx
- Add a "Include" checkbox column to the per-property table
- When toggled off, upsert `listing_tax_settings` with `excluded_from_tax = true`
- When toggled on, set `excluded_from_tax = false`
- Save happens immediately on toggle (no need to click Save separately for this field)

### 3. TaxReportGenerator.tsx
- After fetching listings and tax settings, filter out any listing where `listing_tax_settings.excluded_from_tax = true`
- This affects both the table display and CSV export

### Files Modified
- `listing_tax_settings` table (migration)
- `src/components/TaxSettingsTable.tsx`
- `src/components/TaxReportGenerator.tsx`

