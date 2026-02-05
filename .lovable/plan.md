
# Fix Calendar Sync Self-Invocation - Part 2

## Problem Found

The previous fix was incomplete. The `sync-bulk-calendar` function has **two** authorization gates:

1. **Line 502-508**: Hard requirement for `Authorization` header to exist
2. **Line 517-518**: Service-role bypass check

When we changed self-invocation to pass only `x-service-role: true`, requests fail at gate #1 before reaching gate #2.

---

## Current State (Feb 5, 3:00 AM Run)

| Account | Listings | Reservations | Calendar | Airbnb Scrape |
|---------|----------|--------------|----------|---------------|
| Renjoy | ❌ OAuth rate limit | ❌ OAuth rate limit | ❌ OAuth rate limit | ❌ Never reached |
| Beachside VR | ✅ 465 synced | ✅ 484 synced | 🔄 Stuck at 50/271 | ❌ Never reached |

---

## Fix Required

**File:** `supabase/functions/sync-bulk-calendar/index.ts`

Move the `x-service-role` check **before** the Authorization requirement:

```typescript
// Check for service role invocation FIRST
const isServiceRole = req.headers.get('x-service-role') === 'true';

if (!isServiceRole) {
  // Only require Authorization for non-service-role calls
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, ... }
    );
  }
  // ... rest of user auth logic
}
```

---

## Technical Details

| Line Range | Current Behavior | New Behavior |
|------------|-----------------|--------------|
| 502-508 | Requires Authorization header always | Only requires for non-service-role |
| 517-518 | Checks service role after auth requirement | Check service role first |

---

## Expected Outcome

- Self-invocations with `x-service-role: true` bypass auth completely
- Calendar sync batches can continue without authorization failures
- Tonight's nightly sync will complete for both accounts
- Portfolio-wide steps (Airbnb scrape, forecasts, actionables) will finally run
