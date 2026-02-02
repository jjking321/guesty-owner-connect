

# Fix Nightly Sync Issues

## Overview

The automated nightly sync is running but encountering three specific issues that need to be addressed:

1. **Calendar sync returns 401 Unauthorized** - The `sync-bulk-calendar` function requires user authentication but the nightly orchestrator calls it without a user token
2. **Reservations sync times out** - Large upserts exceed database statement timeout limits
3. **Early function termination** - Functions using `EdgeRuntime.waitUntil()` terminate prematurely when called from the orchestrator

## Issue 1: Calendar Sync 401 Error

### Problem
The `sync-bulk-calendar` function has user authentication checks that fail when called from the orchestrator:

```typescript
// Current code that fails:
const { data: { user }, error: authError } = await userClient.auth.getUser();
if (authError || !user) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}
```

### Solution
Add service-role detection to bypass user auth when called from the orchestrator:

```typescript
// Check for service role invocation (from nightly-sync)
const isServiceRole = authHeader?.includes('service_role') || 
  req.headers.get('x-service-role') === 'true';

if (!isServiceRole) {
  // Only require user auth for direct user calls
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}
```

Also update the orchestrator to pass a header indicating service invocation.

## Issue 2: Reservations Statement Timeout

### Problem
The `sync-new-reservations` function performs a single large upsert that exceeds database timeout limits:

```typescript
// Current code that times out on large datasets:
const { error: upsertError } = await supabase
  .from('reservations')
  .upsert(uniqueReservations, { onConflict: 'id' });
```

### Solution
Batch the upsert into chunks of 200 records:

```typescript
// Batch upsert in chunks of 200
const BATCH_SIZE = 200;
let totalUpserted = 0;

for (let i = 0; i < uniqueReservations.length; i += BATCH_SIZE) {
  const batch = uniqueReservations.slice(i, i + BATCH_SIZE);
  
  const { error: upsertError } = await supabase
    .from('reservations')
    .upsert(batch, { onConflict: 'id' });
  
  if (upsertError) {
    console.error(`Batch upsert error at index ${i}:`, upsertError);
    throw upsertError;
  }
  
  totalUpserted += batch.length;
  
  // Update progress
  if (syncJobId) {
    await supabase
      .from('sync_jobs')
      .update({
        items_synced: totalUpserted,
        progress_message: `Upserting reservations... (${totalUpserted}/${uniqueReservations.length})`,
      })
      .eq('id', syncJobId);
  }
  
  // Small delay between batches to avoid overwhelming the database
  if (i + BATCH_SIZE < uniqueReservations.length) {
    await sleep(100);
  }
}
```

## Issue 3: Function Termination (EdgeRuntime.waitUntil)

### Problem
The `sync-bulk-calendar` function uses `EdgeRuntime.waitUntil()` for background processing and returns immediately. When called from the orchestrator, the function terminates before the background work completes.

### Solution
This is actually already handled correctly because:
- The orchestrator polls `sync_jobs` table for completion status
- The `sync-bulk-calendar` function creates a sync job and updates it when done
- The background task continues even after the initial response

The 401 error is preventing the function from even starting, so once we fix Issue 1, the polling should work correctly.

## Implementation Steps

### Step 1: Update sync-bulk-calendar Authentication

Modify `supabase/functions/sync-bulk-calendar/index.ts` to allow service-role invocation:

| Change | Description |
|--------|-------------|
| Add service role detection | Check for service invocation header |
| Conditional auth | Only require user auth for direct calls |
| Keep security | Service role is trusted, user calls still validated |

### Step 2: Update nightly-sync Orchestrator

Modify `supabase/functions/nightly-sync/index.ts` to pass service invocation header:

```typescript
const { error: calendarInvokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
  body: { guestyAccountId: account.id },
  headers: { 'x-service-role': 'true' }
});
```

### Step 3: Add Batched Upsert to sync-new-reservations

Modify `supabase/functions/sync-new-reservations/index.ts` to batch database operations:

| Change | Description |
|--------|-------------|
| Chunk reservations | Split into batches of 200 |
| Progress updates | Update sync_jobs between batches |
| Small delays | 100ms between batches to prevent overload |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-bulk-calendar/index.ts` | Add service-role bypass for auth |
| `supabase/functions/nightly-sync/index.ts` | Add service invocation header |
| `supabase/functions/sync-new-reservations/index.ts` | Batch upserts in chunks of 200 |

## Expected Results After Fix

| Sync Type | Current Status | After Fix |
|-----------|---------------|-----------|
| Listings | Working | Working |
| Reservations | Timeout on large accounts | Batched, no timeout |
| Owners | Working | Working |
| Calendar | 401 Unauthorized | Working with service auth bypass |

## Testing

After implementation:
1. Manually trigger the nightly-sync function
2. Monitor edge function logs for all four sync types
3. Verify all syncs complete successfully
4. Check `last_automated_sync` timestamp updates

