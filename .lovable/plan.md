

# Move "Platforms That Remit Taxes" to Organization Level

## What's Changing

Currently, the `behalf_platforms` setting (which platforms remit taxes on your behalf) is configured per property in the settings table. You want this to be a single global setting for the entire organization -- the same platforms apply to all properties.

## Changes

### 1. Database: New `organization_tax_settings` table

Create a simple org-level table to store the global behalf platforms:

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | auto-generated |
| organization_id | uuid (unique) | one row per org |
| behalf_platforms | text[] | e.g. `{"airbnb2"}` |
| created_at / updated_at | timestamps | |

RLS policies scoped to org members (same pattern as other org tables). The `behalf_platforms` column will be removed from `listing_tax_settings` (but left in the DB for now to avoid data loss -- just ignored in code).

### 2. Settings page update (`TaxSettingsTable.tsx`)

- Remove the per-row platform checkboxes column from the property table
- Add a separate section **above** the property table with a card titled "Platforms that remit taxes on your behalf"
- Shows checkboxes for all distinct reservation sources, saved to `organization_tax_settings`
- The property table keeps only: Property, Permit Number, Tax Address, Save button

### 3. Report generator update (`TaxReportGenerator.tsx`)

- Instead of reading `behalf_platforms` from each `listing_tax_settings` row, read the single `organization_tax_settings` row for the org
- Use that global list to split reservations into "behalfPlatforms" vs "other" for all properties

### 4. Tax exempt table update (`TaxExemptTable.tsx`)

- If it references `behalf_platforms` from listing settings, update to use the org-level setting instead

## Technical Details

### Migration SQL

```sql
CREATE TABLE organization_tax_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL,
  behalf_platforms text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE organization_tax_settings ENABLE ROW LEVEL SECURITY;

-- RLS: org members can view
CREATE POLICY "Org members can view tax settings"
  ON organization_tax_settings FOR SELECT
  USING (is_organization_member(organization_id, auth.uid()));

-- RLS: admins can insert/update
CREATE POLICY "Admins can insert tax settings"
  ON organization_tax_settings FOR INSERT
  WITH CHECK (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

CREATE POLICY "Admins can update tax settings"
  ON organization_tax_settings FOR UPDATE
  USING (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

-- Seed from existing data (pick the most common behalf_platforms across listings)
INSERT INTO organization_tax_settings (organization_id, behalf_platforms)
SELECT DISTINCT organization_id, behalf_platforms
FROM listing_tax_settings
WHERE behalf_platforms != '{}'
ON CONFLICT (organization_id) DO NOTHING;
```

### Files Modified

- **`src/components/TaxSettingsTable.tsx`** -- Remove platform checkboxes from per-property rows; add global platform selector card above the table; save to `organization_tax_settings`
- **`src/components/TaxReportGenerator.tsx`** -- Fetch `organization_tax_settings` instead of using per-listing `behalf_platforms`; use that single list for all properties
- **`src/components/TaxExemptTable.tsx`** -- Same change if it references behalf_platforms

