

# Add Tax Amount Tracking to Reservations

## Overview
Add a `tax_amount` column to the `reservations` table and update all three reservation sync functions to fetch and store `money.totalTaxes` from the Guesty API. This will be stored for reference only and will **not** affect any existing revenue calculations, forecasts, or night allocations.

## Changes

### 1. Database Migration
Add a nullable `tax_amount` numeric column to the `reservations` table:
```sql
ALTER TABLE reservations ADD COLUMN tax_amount numeric;
```

### 2. Edge Function Updates (3 files)

All three Guesty sync functions need identical changes:

**Files:**
- `supabase/functions/sync-guesty-data/index.ts`
- `supabase/functions/sync-new-reservations/index.ts`
- `supabase/functions/sync-listing-reservations/index.ts`

**In each file:**
1. Add `totalTaxes?: number` to the `GuestyReservation.money` interface
2. Add `money.totalTaxes` to the `fields` parameter in the API request
3. Map `reservation.money?.totalTaxes` to `tax_amount` in the upsert object

### What stays the same
- `fare_accommodation_adjusted` remains the basis for revenue calculations, night allocations, forecasts, and goals
- The `reservation_nights` trigger and `get_distributed_revenue` function are untouched
- No UI changes in this phase (tax data will simply be stored for future use)

