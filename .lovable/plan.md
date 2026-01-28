

## ✅ COMPLETED: Fix Bulk Reservation Sync Timeout with Self-Invocation

### Problem
The `sync-guesty-data` edge function tried to sync all 27,333 reservations in a single call. Edge functions have a ~60-second timeout, causing the sync to fail consistently around 11,000 records.

### Solution Implemented
Added self-invocation pattern (same as `sync-bulk-calendar`) to process reservations in chunks with automatic continuation.

### Changes Made

#### 1. Added Constants for Batch Processing
```typescript
const RESERVATION_BATCH_LIMIT = 3000; // Process this many records before self-invoking
const FUNCTION_TIMEOUT_BUFFER = 50000; // 50 seconds - leave 10s buffer before timeout
```

#### 2. Updated `fetchAndSaveReservationsBatch` Function
- Added `startTime` parameter for time tracking
- Added `recordsProcessedThisInvocation` counter
- Returns `{ needsContinuation, nextOffset }` to signal when self-invocation is needed

#### 3. Added Self-Invocation Logic
- Checks after each batch save if limits are reached
- Saves progress to `sync_jobs` with `last_synced_offset`
- Self-invokes with `resumeJobId` parameter
- Returns early with `continuing: true` response

#### 4. Handle Continuation
- New `resumeJobId` request parameter for self-invocation
- Prioritizes resume job over creating new job
- Skips if job was cancelled or completed

### Expected Behavior After Fix

1. User clicks "Sync Reservations"
2. Function processes ~3000 reservations (~50 seconds)
3. Function saves progress and self-invokes
4. New invocation continues from saved offset
5. Repeat until all reservations are synced
6. Progress bar updates continuously throughout
