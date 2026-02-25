

# Add Real-Time Progress to Backfill Subtotals

## Summary
Add a live progress bar to the BackfillSubtotals component using the existing `SyncProgressCard` pattern, and ensure OAuth token sharing is properly handled.

## OAuth Status
The `backfill-reservation-subtotals` edge function already uses `getGuestyAccessTokenCached()` with the shared `guesty_oauth_tokens` table. This means it shares cached tokens with all other Guesty sync functions and respects cooldown periods. No changes needed here.

## Changes

### 1. Update `SyncProgressCard` to support `backfill_subtotals` sync type
- Add `'backfill_subtotals'` to the `syncType` union in `SyncProgressCardProps`
- Add a display name mapping: `'backfill_subtotals'` → `'Subtotal Backfill'`

### 2. Update `BackfillSubtotals` component to show `SyncProgressCard`
- Import and render `SyncProgressCard` below the backfill button
- Pass the first account's ID and `syncType="backfill_subtotals"`
- The `SyncProgressCard` handles all realtime subscription logic (polling for running jobs, subscribing to `postgres_changes` on `sync_jobs`)

### 3. Enable realtime on `sync_jobs` table (if not already)
- Verify `sync_jobs` is in the `supabase_realtime` publication. If not, add a migration.

### Files to edit
- `src/components/SyncProgressCard.tsx` (add `backfill_subtotals` to type union and display name)
- `src/components/BackfillSubtotals.tsx` (add `SyncProgressCard` with realtime progress)

