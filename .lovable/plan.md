
# Fix Calendar Sync Self-Invocation Bug

## Problem Summary

The nightly sync successfully triggers, but gets stuck at the calendar sync step because `sync-bulk-calendar` cannot continue past its first batch of 50 listings. The self-invocation call fails with **401 Unauthorized**.

---

## Root Cause

In `sync-bulk-calendar`, lines 455-458:
```typescript
const { error: invokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
  headers: { Authorization: `Bearer ${authToken}` },
  body: { guestyAccountId, guestyToken: accessToken },
});
```

When you provide a `headers` object to `supabase.functions.invoke()`, it **replaces** the default headers instead of merging with them. This causes:
- The `apikey` header (required by Supabase gateway) to be missing
- The request fails with 401 even though Authorization is present

---

## Solution

### 1. Fix Self-Invocation (Primary Fix)
**File:** `supabase/functions/sync-bulk-calendar/index.ts`

Change the self-invocation to **not override headers**. Instead:
- Pass the `x-service-role: true` header marker only
- Omit the Authorization header (the service role client already has the service key attached)
- The function should detect service-role calls via the `x-service-role` header

```typescript
// Before (broken)
const { error: invokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
  headers: { Authorization: `Bearer ${authToken}` },
  body: { guestyAccountId, guestyToken: accessToken },
});

// After (fixed)
const { error: invokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
  headers: { 'x-service-role': 'true' },
  body: { guestyAccountId, guestyToken: accessToken },
});
```

### 2. Strengthen Service-Role Detection
The check at lines 515-517 relies on `x-service-role` header which is the correct approach. No changes needed here since the fix above ensures that header is always passed.

### 3. Resume the Stuck Job
After deploying the fix, I'll manually invoke the calendar sync for the stuck `renjoy guesty` account to resume from offset 100 and complete the remaining 105 listings.

---

## Technical Details

| Step | Action |
|------|--------|
| 1 | Update self-invocation to pass `x-service-role: true` instead of `Authorization` header |
| 2 | Deploy the updated edge function |
| 3 | Resume stuck calendar job for renjoy account |
| 4 | Verify completion by checking sync_jobs status |

---

## Expected Outcome

- Calendar sync will process all 205 listings for renjoy
- `last_automated_sync` will update for renjoy account  
- Nightly sync will proceed to process Beachside VR
- Portfolio-wide steps (forecasts, actionables) will run
- Tonight's 3 AM UTC run will complete successfully
