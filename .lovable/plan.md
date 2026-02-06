

# Plan: Enhanced Logging and Reliability for Nightly Sync

## Current State Analysis

After reviewing the implementation, I found several areas that could use better logging and safeguards:

### What's Already Good
- State machine pattern with self-invocation works around the 60s timeout
- Retry tracking with `retry_count` and `retry_of` columns
- Rate limit detection to avoid futile retries
- Maximum invocation and run time limits
- Both cron jobs registered (3 AM sync, 5:30 AM verify)

### Gaps Identified

| Issue | Risk | Impact |
|-------|------|--------|
| No step timing captured | Can't identify slow steps | Debugging difficulty |
| Verification retry doesn't preserve retry tracking | Retry creates new run, then deletes it | `retry_count` not properly incremented |
| Silent failures in child function invocations | `.catch()` swallows errors | Hard to trace what failed |
| No summary of what completed vs failed | `step_results` is sparse | Poor observability |
| No alert mechanism for persistent failures | Syncs fail silently | User doesn't know |
| Verification doesn't check step_results for partial failures | Only checks overall status | Might not retry a "completed with issues" run |

## Proposed Enhancements

### 1. Add Step Timing Logs

Track start/end time for each pipeline step:

```typescript
step_results: {
  account_syncs: {
    started_at: "2026-02-06T03:00:15Z",
    completed_at: "2026-02-06T03:45:22Z",
    duration_seconds: 2707
  },
  airbnb_ratings: { ... }
}
```

### 2. Fix Retry Tracking Bug

Current code creates a new run with retry tracking, then immediately deletes it. Fix by passing retry info to the new run:

```typescript
// Instead of creating/deleting, pass retry context
await supabaseInvoke.functions.invoke('nightly-sync', { 
  body: { 
    retry_of: run.id, 
    retry_count: retryCount + 1 
  } 
});
```

### 3. Add Per-Account Summary

When account syncs complete, log a summary:

```typescript
step_results: {
  account_syncs: {
    summary: {
      total_accounts: 2,
      successful: 2,
      failed: 0,
      accounts: {
        "account-id-1": { 
          name: "Beachside VR",
          phases_completed: ["listings", "reservations", "owners", "calendar"],
          success: true 
        },
        "account-id-2": { ... }
      }
    }
  }
}
```

### 4. Enhanced Verification Logging

Add more detailed logging in verification mode:

```typescript
console.log('=== VERIFICATION REPORT ===');
console.log(`Run ID: ${run.id}`);
console.log(`Status: ${run.status}`);
console.log(`Started: ${run.started_at}`);
console.log(`Current Step: ${run.current_step}`);
console.log(`Invocations: ${run.invocation_count}`);
console.log(`Account States:`, JSON.stringify(run.account_states, null, 2));
console.log(`Step Results:`, JSON.stringify(run.step_results, null, 2));
```

### 5. Track Partial Failures

Check `step_results` for any failures even if overall status is "completed":

```typescript
function hasPartialFailures(stepResults: Record<string, any>): string[] {
  const failures: string[] = [];
  for (const [step, result] of Object.entries(stepResults)) {
    if (result?.success === false || result?.error) {
      failures.push(`${step}: ${result.error || 'failed'}`);
    }
  }
  return failures;
}
```

### 6. Add Failure Escalation Notes

When verification finds a failure, log why we're not retrying or what we're retrying:

```typescript
if (isRateLimitError(run.error_message)) {
  console.log('=== NOT RETRYING: RATE LIMIT ===');
  console.log('The Guesty API returned rate limit errors.');
  console.log('Manual intervention may be needed if this persists.');
  console.log('Consider checking: https://app.guesty.com for API status');
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/nightly-sync/index.ts` | Add timing, fix retry tracking, enhance logging, add partial failure detection |

## Implementation Details

### New Helper Function: `logStepTiming`

```typescript
async function logStepTiming(
  supabase: any,
  runId: string,
  stepName: string,
  action: 'start' | 'end'
): Promise<void> {
  const { data: run } = await supabase
    .from('nightly_sync_runs')
    .select('step_results')
    .eq('id', runId)
    .single();

  const stepResults = run?.step_results || {};
  const stepData = stepResults[stepName] || {};
  
  if (action === 'start') {
    stepData.started_at = new Date().toISOString();
  } else {
    stepData.completed_at = new Date().toISOString();
    if (stepData.started_at) {
      stepData.duration_seconds = Math.round(
        (Date.now() - new Date(stepData.started_at).getTime()) / 1000
      );
    }
  }

  await supabase.from('nightly_sync_runs').update({
    step_results: { ...stepResults, [stepName]: stepData }
  }).eq('id', runId);
}
```

### Fixed Retry Handling

```typescript
// In handleVerification, for non-rate-limit failures:
console.log(`Starting retry #${retryCount + 1} for failed run ${run.id}`);

// Pass retry context to new run initialization
await supabaseInvoke.functions.invoke('nightly-sync', { 
  body: { 
    retry_of_run_id: run.id, 
    retry_number: retryCount + 1 
  } 
});
```

### Enhanced Completion Summary

```typescript
async function completeRun(supabase: any, run: NightlySyncRun): Promise<void> {
  const duration = Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000);
  
  // Build account summary
  const accountSummary: Record<string, any> = {};
  for (const accountId of run.account_ids) {
    const state = run.account_states[accountId];
    accountSummary[accountId] = {
      phases_completed: state?.phasesCompleted || [],
      final_phase: state?.currentPhase,
      success: state?.currentPhase === 'done' && !state?.error,
      error: state?.error
    };
  }
  
  const successfulAccounts = Object.values(accountSummary).filter(a => a.success).length;
  const failedAccounts = Object.values(accountSummary).filter(a => !a.success).length;

  console.log('=== NIGHTLY SYNC COMPLETE ===');
  console.log(`Run ID: ${run.id}`);
  console.log(`Duration: ${duration} seconds (${Math.round(duration/60)} minutes)`);
  console.log(`Accounts: ${successfulAccounts} successful, ${failedAccounts} failed`);
  console.log(`Invocations used: ${run.invocation_count}/${MAX_INVOCATIONS}`);
  console.log('Account details:', JSON.stringify(accountSummary, null, 2));
  console.log('Step results:', JSON.stringify(run.step_results, null, 2));

  await supabase.from('nightly_sync_runs').update({
    status: failedAccounts > 0 ? 'completed_with_errors' : 'completed',
    completed_at: new Date().toISOString(),
    step_results: {
      ...run.step_results,
      summary: {
        duration_seconds: duration,
        duration_minutes: Math.round(duration/60),
        accounts_total: run.account_ids.length,
        accounts_successful: successfulAccounts,
        accounts_failed: failedAccounts,
        invocations_used: run.invocation_count,
        completed_at: new Date().toISOString(),
        account_details: accountSummary
      }
    },
  }).eq('id', run.id);
}
```

## Expected Outcome

After these changes, you'll have:

1. **Full timing visibility** - Know exactly how long each step takes
2. **Proper retry tracking** - `retry_count` correctly incremented across retries
3. **Clear completion status** - "completed" vs "completed_with_errors"
4. **Rich step results** - Per-account breakdown of what succeeded/failed
5. **Enhanced logs** - Easy to trace through Edge Function logs what happened
6. **Partial failure detection** - Verification can identify runs that completed but had issues

