

# Tax Reporting Module

## Overview
Build a new "Tax Report" page that lets you generate the Brevard Tourism Tax CSV from your reservation data. This involves storing tax permit numbers and platform tax-remittance settings per property, then computing the report by splitting revenue into "behalf platforms" vs "other" and breaking the combined tax field into county (5%) and state (7%) based on `total_paid`.

## What You'll Get
- A new `/tax-report` page accessible from the sidebar
- A property tax settings section where you assign **permit numbers** and configure **which platforms remit taxes on your behalf** for each listing
- A report generator that, for a selected month:
  - Groups reservations by listing
  - Splits revenue into two rows per property: "behalfPlatforms" and "other"
  - Computes county tax (5% of `total_paid`) and state tax (7% of `total_paid`) from the combined `tax_amount`
  - Breaks out tax-exempt reservations ($0 tax) into a separate section showing guest name and total accommodation
- CSV export matching your existing Brevard Tourism Tax format

## Database Changes

### New table: `listing_tax_settings`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | auto-generated |
| listing_id | text (unique) | references listings |
| permit_number | text | e.g. "25-001764" |
| property_address | text | formatted address for tax filing |
| behalf_platforms | text[] | array of source values that remit taxes, e.g. `{"airbnb2"}` |
| organization_id | uuid | for RLS scoping |
| created_at / updated_at | timestamps | |

RLS policies will mirror the existing listing-based org membership pattern.

## Technical Details

### Tax Calculation Logic
The CSV `Total Revenue` column = `fare_accommodation_adjusted` (accommodation revenue for that provider category). The county/state split works like this:
- For each reservation, the `tax_amount` field contains the combined tax
- County share = `tax_amount * (5/12)` (5% out of 12% total)
- State share = `tax_amount * (7/12)` (7% out of 12% total)
- Tax-exempt reservations: where `tax_amount` is 0 or null, listed separately with guest name and `fare_accommodation_adjusted`

### Platform Categorization
Each reservation's `source` field is checked against the listing's `behalf_platforms` array:
- If source matches -> revenue goes in the "behalfPlatforms" row
- If source doesn't match -> revenue goes in the "other" row

### Page Layout
1. **Settings tab**: Table of all listings with editable permit number, address override, and multi-select for behalf platforms (populated from the distinct sources in your reservations)
2. **Report tab**: Month/year picker, preview table matching the CSV format, and "Download CSV" button
3. **Exempt tab**: Table of $0-tax reservations for the selected period showing property, guest name, accommodation amount, platform

### New Files
- `src/pages/TaxReport.tsx` - main page with tabs
- `src/components/TaxSettingsTable.tsx` - permit number and platform config per listing
- `src/components/TaxReportGenerator.tsx` - report preview and CSV export
- `src/components/TaxExemptTable.tsx` - exempt reservation listing
- Route added to `App.tsx` at `/tax-report`
- Sidebar entry added to `AppSidebar.tsx`

### Migration SQL
```sql
CREATE TABLE listing_tax_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text UNIQUE NOT NULL,
  permit_number text,
  property_address text,
  behalf_platforms text[] DEFAULT '{}',
  organization_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE listing_tax_settings ENABLE ROW LEVEL SECURITY;

-- Standard org-member policies for SELECT, INSERT, UPDATE, DELETE
```

