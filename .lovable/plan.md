

# Roll Up Multi-Unit Properties by Tax Permit Number

## Problem
Some properties share a single tax permit number (e.g., "400 S Atlantic Full" and "400 S Atlantic #G" both use permit 25-001797). The tax report currently shows each unit as a separate line, but for filing purposes they need to be consolidated into a single line per permit number.

## Current Duplicates
- **25-001797** (400 S ATLANTIC AVE): "400 S Atlantic Full" + "400 S Atlantic #G"
- **25-001839** (637 S ORLANDO AVE): "637 S Orlando Full" + "637 S Orlando #1"
- Plus any future groupings (like 141 California units)

## Recommended Approach

### Add a "Tax Group" concept to the settings
Rather than just having permit number per listing, add an optional **tax_group_id** field to `listing_tax_settings`. Listings that share the same tax group will be rolled up into a single row on the report.

### How it works:

1. **New database table: `tax_groups`** -- stores permit number, address, and a display name (e.g., "400 S Atlantic") for each shared permit
2. **New column on `listing_tax_settings`**: `tax_group_id` (nullable) -- when set, this listing's revenue rolls up into that group on the report
3. **Tax Report Generator change**: Before rendering rows, group all listings that share a `tax_group_id`. Sum their payouts, taxes, and deductions into one line. Show individual unit names in a tooltip or sub-text for reference.
4. **Tax Settings UI**: Add a section to create/manage tax groups and assign listings to them

### Report output for grouped properties

```text
Period          | Permit #   | Property Address                        | Provider        | Total Payout | Tax
February 2026   | 25-001797  | 400 S ATLANTIC AVE COCOA BEACH FL 32931 | behalfPlatforms | $X,XXX.XX    | $XXX.XX
February 2026   | 25-001797  | 400 S ATLANTIC AVE COCOA BEACH FL 32931 | other           | $X,XXX.XX    | $XXX.XX
```

Instead of 4 separate rows (2 per unit), you get 2 rows with summed totals.

## Technical Details

### Step 1: Create `tax_groups` table

```text
tax_groups
  - id (uuid, PK)
  - organization_id (uuid, NOT NULL)
  - name (text) -- display name like "400 S Atlantic"
  - permit_number (text)
  - property_address (text)
  - created_at, updated_at
```

RLS: org members can view, admins can manage.

### Step 2: Add `tax_group_id` to `listing_tax_settings`

- Nullable FK to `tax_groups.id`
- When a listing has a `tax_group_id`, the report uses the group's permit/address and rolls up revenue

### Step 3: Update `TaxReportGenerator.tsx`

- After building per-listing data, check for `tax_group_id`
- Listings with the same `tax_group_id` get their payout/tax/deductions summed into one report row
- Listings without a group continue to show individually
- The Nickname column shows the group name (or comma-separated unit names)

### Step 4: Update `TaxSettingsTable.tsx`

- Add a "Tax Groups" section at the top to create/edit groups
- Add a dropdown on each listing row to assign it to a tax group
- When assigned to a group, the individual permit/address fields become read-only (inherited from group)

### Step 5: CSV export

- Grouped rows export as a single line (matching filing requirements)
- Nickname column in CSV shows the group name

