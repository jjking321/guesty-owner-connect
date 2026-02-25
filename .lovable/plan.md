

# Replace "Total Payout" with Guesty `money.subTotal`

## Summary
Swap the revenue display column from `host_payout` to a new `sub_total` field (sourced from Guesty's `money.subTotal`). Tax calculations remain unchanged (still using `tax_amount * 5/12` for county and `tax_amount * 7/12` for state).

## Changes

### 1. Database: Add `sub_total` column to `reservations`
- Add nullable numeric column `sub_total` to the `reservations` table

### 2. Edge Functions: Sync `money.subTotal` from Guesty
Three files need `sub_total: reservation.money?.subTotal` added to the upsert object:
- `supabase/functions/sync-guesty-data/index.ts` (two upsert locations)
- `supabase/functions/sync-new-reservations/index.ts`
- `supabase/functions/sync-listing-reservations/index.ts`

### 3. Frontend: Use `sub_total` instead of `host_payout` for display
- **`TaxReportGenerator.tsx`**: Change the reservation query to fetch `sub_total` instead of `host_payout`. Update `sumField` and `computeListingData` to sum `sub_total` for the payout columns. The tax calculation (`tax_amount * multiplier`) stays exactly the same.
- **`TaxTemplateFill.tsx`**: Same swap — use `sub_total` instead of `host_payout` for the "Total Revenue" column in the template fill logic.
- **`TaxExemptTable.tsx`**: No changes needed (uses `fare_accommodation_adjusted`).

### 4. Backfill (follow-up)
Existing reservations won't have `sub_total` populated until re-synced. A backfill function (similar to the existing `backfill-reservation-taxes`) can be created to fetch `money.subTotal` for historical records.

### Files to edit
- New migration (add `sub_total` column)
- `supabase/functions/sync-guesty-data/index.ts`
- `supabase/functions/sync-new-reservations/index.ts`
- `supabase/functions/sync-listing-reservations/index.ts`
- `src/components/TaxReportGenerator.tsx`
- `src/components/TaxTemplateFill.tsx`

