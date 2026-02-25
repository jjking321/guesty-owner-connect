

# Fix: Use Correct Guesty Field Name `subTotalPrice` Instead of `subTotal`

## Root Cause

Every Guesty sync function in the project requests `money.subTotal`, but the actual field name in the Guesty API response is `money.subTotalPrice`. This is why the database has zero positive `sub_total` values across all 61,965 reservations -- the field has never been correctly mapped.

## Changes Required

All four edge functions that reference `money.subTotal` need to be updated to `money.subTotalPrice`:

### 1. `supabase/functions/backfill-reservation-subtotals/index.ts`
- Line 135: Type definition `subTotal` → `subTotalPrice`
- Line 143: Fields param `money.subTotal` → `money.subTotalPrice`
- Line 304: Type in processPage `subTotal` → `subTotalPrice`
- Line 307: Access `res.money?.subTotal` → `res.money?.subTotalPrice`
- Line 410: Progress message text (cosmetic)

### 2. `supabase/functions/sync-guesty-data/index.ts`
- Line 26: Type definition `subTotal` → `subTotalPrice`
- Line 380: Fields param `money.subTotal` → `money.subTotalPrice`
- Line 409: Mapping `reservation.money?.subTotal` → `reservation.money?.subTotalPrice`
- Line 532: Same mapping (second upsert block)

### 3. `supabase/functions/sync-new-reservations/index.ts`
- Line 33: Type definition `subTotal` → `subTotalPrice`
- Line 462: Fields param `money.subTotal` → `money.subTotalPrice`
- Line 531: Mapping `reservation.money?.subTotal` → `reservation.money?.subTotalPrice`

### 4. `supabase/functions/sync-listing-reservations/index.ts`
- Line 33: Type definition `subTotal` → `subTotalPrice`
- Line 401: Fields param `money.subTotal` → `money.subTotalPrice`
- Line 438: Mapping `reservation.money?.subTotal` → `reservation.money?.subTotalPrice`

## No Database or Frontend Changes

The database column stays `sub_total`. The frontend components (`TaxReportGenerator.tsx`, `TaxTemplateFill.tsx`) already reference `sub_total` correctly. Only the API field name in the edge functions is wrong.

## After Deployment

Re-run the backfill for a test month (e.g., January 2026) to verify `subTotalPrice` values are now being captured and written to `sub_total`.

