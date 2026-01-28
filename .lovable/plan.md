

## Fix Bulk Reservation Sync Timeout with Self-Invocation

### Problem
The `sync-guesty-data` edge function tries to sync all 27,333 reservations in a single call. Edge functions have a ~60-second timeout, causing the sync to fail consistently around 11,000 records.

### Solution
Add self-invocation pattern (same as `sync-bulk-calendar`) to process reservations in chunks, with automatic continuation.

### Implementation Plan

#### 1. Add Constants for Batch Processing
```typescript
const RESERVATION_BATCH_LIMIT = 3000; // Process this many before self-invoking
const FUNCTION_TIMEOUT_BUFFER = 50000; // 50 seconds - leave 10s buffer before timeout
```

#### 2. Track Execution Time
Add a start time tracker at the beginning of the reservations sync to detect when we're approaching the timeout.

#### 3. Modify `fetchAndSaveReservationsBatch` Function
Add parameters for:
- `maxRecords`: Stop after processing this many records
- `startTime`: Track elapsed time
- Return whether there are more records to process

#### 4. Add Self-Invocation Logic
After saving a batch, check if:
- We've processed `RESERVATION_BATCH_LIMIT` records, OR
- We're within `FUNCTION_TIMEOUT_BUFFER` of the timeout

If either condition is met:
- Save current progress to `sync_jobs` (with `last_synced_offset`)
- Self-invoke the function with the same parameters
- Return early with success

#### 5. Handle Continuation
When the function starts, check for:
- Existing "running" sync job for this account/type
- Use `last_synced_offset` to resume from where it left off

### Technical Changes

| Component | Change |
|-----------|--------|
| Constants | Add `RESERVATION_BATCH_LIMIT`, `FUNCTION_TIMEOUT_BUFFER` |
| `fetchAndSaveReservationsBatch` | Add time tracking, early exit when batch limit reached |
| Reservations sync block | Add self-invocation after batch completion |
| Request handling | Pass auth token for self-invocation |

### Self-Invocation Pattern (from sync-bulk-calendar)
```typescript
// After processing batch, if more records exist:
const { error: invokeError } = await supabase.functions.invoke('sync-guesty-data', {
  headers: { Authorization: `Bearer ${authToken}` },
  body: { accountId, syncType: 'reservations', startDate, resumeJobId: jobId },
});
```

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-guesty-data/index.ts` | Add self-invocation logic, batch limits, time tracking |

### Expected Behavior After Fix

1. User clicks "Sync Reservations"
2. Function processes ~3000 reservations (~50 seconds)
3. Function saves progress and self-invokes
4. New invocation continues from offset 3000
5. Repeat until all 27,333 reservations are synced
6. Total time: ~9 invocations over ~8 minutes
7. Progress bar updates continuously throughout

### Rollback Risk
Low - the function already has resume capability via `last_synced_offset`. This change just automates the continuation.

