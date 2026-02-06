

# Plan: Add 5:30 AM Verification and Retry for Nightly Sync

## Overview

Add a verification cron job that runs at **5:30 AM UTC** (2.5 hours after the 3 AM sync) to check if the nightly sync completed successfully. If it failed for reasons other than rate limiting, it will automatically retry.

## Implementation

### 1. Update Edge Function

Add verification mode logic to handle `{ verify: true }` requests:

```typescript
// New code path at the start of the request handler
if (body.verify) {
  return await handleVerification(supabase, supabaseInvoke);
}
```

**Verification Logic:**
1. Find the most recent run from the last 3 hours
2. If no run found → start new sync (original may have crashed before creating record)
3. If run still running → exit (still in progress)
4. If run completed → log success, exit
5. If run failed:
   - Check if rate-limit related → skip retry, log reason
   - Otherwise → start new sync as retry

**Rate Limit Detection:**
```typescript
function isRateLimitError(message: string | null): boolean {
  if (!message) return false;
  const patterns = ['rate limit', '429', 'too many requests', 'OAUTH_RATE_LIMIT', 'Retry-After'];
  return patterns.some(p => message.toLowerCase().includes(p.toLowerCase()));
}
```

### 2. Database Changes

Add retry tracking columns to `nightly_sync_runs`:

| Column | Type | Description |
|--------|------|-------------|
| retry_count | integer | Number of retry attempts (max 2) |
| retry_of | uuid | Reference to original run if this is a retry |

### 3. Add Verification Cron Job

Schedule at **5:30 AM UTC** via `cron.schedule()`:

```sql
SELECT cron.schedule(
  'nightly-sync-verify',
  '30 5 * * *',  -- 5:30 AM UTC
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body := '{"verify": true}'::jsonb
  );
  $$
);
```

## Safety Limits

- Maximum 2 retry attempts per day
- Won't retry if error contains rate-limit keywords
- Won't retry if a run is still in progress
- Won't retry if the original run completed successfully

## Expected Behavior

| Scenario at 5:30 AM | Action |
|---------------------|--------|
| Run completed successfully | Log success, do nothing |
| Run still in progress | Do nothing (let it finish) |
| Run failed (rate limit) | Log "not retrying", do nothing |
| Run failed (other error) | Start new sync attempt |
| No run found | Start new sync |

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/nightly-sync/index.ts` | Add `handleVerification()` function and rate limit detection |
| Database migration | Add `retry_count`, `retry_of` columns + verification cron job |

