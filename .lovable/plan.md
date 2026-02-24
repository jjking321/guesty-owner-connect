

# Backfill Missing Tax Amounts

## Problem
The full reservation sync keeps hitting database statement timeouts because every upsert fires the `sync_reservation_nights_for_reservation` trigger. You have ~7,669 reservations missing tax data, but you don't need to re-sync everything -- just fetch and update the `tax_amount` field.

## Solution
Create a new `backfill-reservation-taxes` edge function that:
1. Queries your database for reservation IDs where `tax_amount IS NULL`
2. Fetches just the `money.totalTaxes` field from Guesty for each reservation
3. Updates **only** the `tax_amount` column (no trigger fires since `check_in`, `check_out`, etc. aren't changing)
4. Processes in small batches with progress tracking via `sync_jobs`

## How It Works

1. Fetch all reservation IDs with NULL tax_amount from the database
2. Batch them into groups of 50 and call Guesty's reservation endpoint for each one
3. Update `tax_amount` directly using a targeted UPDATE (not upsert) so the nights trigger does NOT fire
4. Track progress in sync_jobs so you can see it in the UI
5. Self-invoke if needed to handle the full ~7,669 reservations without timeout

## Technical Details

### New file: `supabase/functions/backfill-reservation-taxes/index.ts`

- Fetches reservation IDs from DB where `tax_amount IS NULL` and `source != 'manual'` (manual ones won't have Guesty data)
- Calls Guesty API: `GET /v1/reservations/{id}` with `fields=money.totalTaxes` for each reservation
- Batches Guesty calls (10 at a time with 500ms delay to respect rate limits)
- Uses targeted SQL update: `UPDATE reservations SET tax_amount = X WHERE id = Y` -- this avoids the heavy trigger
- Self-invokes after processing ~500 reservations or 40s to avoid timeouts
- Uses the existing OAuth token caching pattern
- Tracks progress via sync_jobs with type `backfill_taxes`

### Database changes

- Add `backfill_taxes` to the `sync_jobs_sync_type_check` constraint so progress tracking works

### Config change: `supabase/config.toml`

- Add `[functions.backfill-reservation-taxes]` with `verify_jwt = true`

### UI: `src/pages/Settings.tsx` or `src/components/TaxSettingsTable.tsx`

- Add a "Backfill Missing Taxes" button in the tax settings area
- Show a SyncProgressCard for the `backfill_taxes` sync type
- Button calls `supabase.functions.invoke('backfill-reservation-taxes', { body: { guestyAccountId } })`

### Files created/modified
- **New**: `supabase/functions/backfill-reservation-taxes/index.ts`
- **Modified**: Database migration (add `backfill_taxes` to sync_type constraint)
- **Modified**: `src/components/TaxSettingsTable.tsx` (add button + progress card)
- **Modified**: `src/components/SyncProgressCard.tsx` (add label for `backfill_taxes` type)

