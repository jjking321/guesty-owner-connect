

# Fix Nightly Sync Pipeline: Stale Job Detection + Data Cleanup

## Problem Summary

Every nightly sync since Feb 7 has been failing in a loop. The root cause is a chain reaction:

1. **Two Airbnb ratings jobs from Feb 7 are permanently stuck** in `running` status (IDs: `bb85facf...` and `08049b0f...`)
2. The `isSyncComplete()` function only checks for `completed` or `failed` -- a `running` job returns `{ complete: false }`, so the orchestrator polls forever
3. The orchestrator burns through all 200 invocations polling these stuck jobs, then fails
4. The 5:30 AM verification triggers a retry, which also gets stuck on the same jobs
5. This has been repeating every night since Feb 7

## Fixes (3 parts)

### Part 1: Add Stale Job Detection to `isSyncComplete()`

**File:** `supabase/functions/nightly-sync/index.ts` (lines 104-129)

Update `isSyncComplete()` to treat any job that has been running for more than 30 minutes as failed:

```typescript
async function isSyncComplete(
  supabase: any,
  accountId: string,
  syncType: string
): Promise<{ complete: boolean; success: boolean; error?: string }> {
  const { data: jobs, error } = await supabase
    .from('sync_jobs')
    .select('status, error_message, started_at')
    .eq('guesty_account_id', accountId)
    .eq('sync_type', syncType)
    .order('started_at', { ascending: false })
    .limit(1);

  if (error || !jobs || jobs.length === 0) {
    return { complete: false, success: false };
  }

  const job = jobs[0];
  if (job.status === 'completed') {
    return { complete: true, success: true };
  }
  if (job.status === 'failed') {
    return { complete: true, success: false, error: job.error_message };
  }
  
  // Treat jobs running > 30 minutes as stale/failed
  if (job.status === 'running' && job.started_at) {
    const runningMs = Date.now() - new Date(job.started_at).getTime();
    const STALE_JOB_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    if (runningMs > STALE_JOB_THRESHOLD_MS) {
      console.warn(`Job for ${syncType} has been running for ${Math.round(runningMs/60000)}min - treating as stale/failed`);
      return { complete: true, success: false, error: `Job stale - running for ${Math.round(runningMs/60000)} minutes` };
    }
  }
  
  return { complete: false, success: false };
}
```

This single change prevents future stuck jobs from blocking the entire pipeline.

### Part 2: Add Same Stale Detection to `processAirbnbRatings()`

**File:** `supabase/functions/nightly-sync/index.ts` (lines 832-848)

The Airbnb ratings check also uses `isSyncComplete()`, so Part 1 already fixes it. But we should also add a fallback: if the orchestrator has been on the AIRBNB_RATINGS step for more than 25 minutes (based on step_results timing), skip ahead regardless.

Add a time-based escape hatch in `processAirbnbRatings()`:

```typescript
// Check if we've been stuck on this step too long
const airbnbStepData = run.step_results?.airbnb_ratings;
if (airbnbStepData?.started_at) {
  const stepRunningMs = Date.now() - new Date(airbnbStepData.started_at).getTime();
  if (stepRunningMs > 25 * 60 * 1000) { // 25 minutes
    console.warn(`Airbnb ratings step has been running for ${Math.round(stepRunningMs/60000)}min - forcing transition`);
    await logStepTiming(supabase, run.id, 'airbnb_ratings', 'end', {
      success: false,
      error: 'Timed out waiting for completion',
      forced: true
    });
    await supabase.from('nightly_sync_runs').update({
      current_step: 'PROBABILITIES',
    }).eq('id', run.id);
    // Continue to fire probabilities below...
  }
}
```

### Part 3: Clean Up Stuck Data

Run SQL to mark the two stuck Feb 7 jobs as failed, and also clean up stuck nightly_sync_runs:

```sql
-- Mark stuck airbnb_ratings sync_jobs as failed
UPDATE sync_jobs 
SET status = 'failed', 
    error_message = 'Marked as failed - job was stuck in running state', 
    completed_at = now() 
WHERE id IN ('bb85facf-92b4-44aa-865b-7283cbc47a49', '08049b0f-ad76-4520-a414-f23b4817ff5a');

-- Mark stuck nightly_sync_runs as failed  
UPDATE nightly_sync_runs 
SET status = 'failed', 
    error_message = 'Marked as failed - was stuck due to stale airbnb_ratings jobs', 
    completed_at = now() 
WHERE status = 'running';
```

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/nightly-sync/index.ts` | Add stale job detection (30min threshold) to `isSyncComplete()` and timeout escape hatch to `processAirbnbRatings()` |
| Database (via insert tool) | Clean up 2 stuck sync_jobs + stuck nightly_sync_runs |

## Expected Result

- Tonight's 3 AM sync will proceed normally through all steps
- Any future stuck jobs will be automatically detected and skipped after 30 minutes
- The Airbnb ratings step has an additional 25-minute safety timeout
- Probabilities, forecasts, and actionables will run even if an earlier step gets stuck

