

# Replace "Total Payout" with Guesty `money.subTotal` — COMPLETED

## Summary
Swapped the revenue display column from `host_payout` to a new `sub_total` field (sourced from Guesty's `money.subTotal`). Tax calculations remain unchanged (still using `tax_amount * 5/12` for county and `tax_amount * 7/12` for state).

## Changes Made

### 1. Database: Added `sub_total` column to `reservations` ✅
### 2. Edge Functions: Syncing `money.subTotal` from Guesty ✅
- `supabase/functions/sync-guesty-data/index.ts` (both upsert locations)
- `supabase/functions/sync-new-reservations/index.ts`
- `supabase/functions/sync-listing-reservations/index.ts`
### 3. Frontend: Using `sub_total` instead of `host_payout` for display ✅
- `src/components/TaxReportGenerator.tsx`
- `src/components/TaxTemplateFill.tsx`

### 4. Backfill (follow-up)
Existing reservations won't have `sub_total` populated until re-synced. A backfill function can be created to fetch `money.subTotal` for historical records.

