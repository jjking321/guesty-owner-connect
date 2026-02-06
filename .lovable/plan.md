

# Plan: Fix Nightly Sync Timeout with Self-Invocation Pattern

## Problem Analysis

The current `nightly-sync` orchestrator has a fundamental architectural flaw:
- It uses polling loops with 10-15 minute timeouts to wait for each sync step
- Edge functions timeout at 60 seconds
- Result: The orchestrator dies before completing even the first sync step

**Evidence from code review:**
- Lines 86-137: `waitForSyncCompletion()` polls every 5 seconds with 10+ minute timeouts
- Lines 190-296: Sequential processing of accounts with 30-second waits between accounts
- Lines 299-416: Sequential processing of post-sync steps (Airbnb ratings, probabilities, forecasts, actionables)

## Solution: State Machine with Self-Invocation

Convert the orchestrator to a **state machine** that:
1. Fires off work, then self-invokes to check progress
2. Tracks current state in a database table
3. Runs accounts in **parallel** (as you suggested - different Guesty accounts don't share rate limits)
4. Processes pipeline steps sequentially (since downstream steps depend on upstream data)

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                      NIGHTLY SYNC STATE MACHINE                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Step 1: INIT                                                         │
│  ├─ Fetch all accounts with automated_sync_enabled                   │
│  ├─ Create nightly_sync_runs record                                  │
│  └─ Transition to ACCOUNT_SYNCS                                      │
│                                                                       │
│  Step 2: ACCOUNT_SYNCS                                                │
│  ├─ Fire off ALL account syncs in PARALLEL:                         │
│  │   • Listings → Reservations → Owners → Calendar (per account)    │
│  ├─ Self-invoke after 15 seconds to check progress                  │
│  └─ When all accounts complete → transition to AIRBNB_RATINGS       │
│                                                                       │
│  Step 3: AIRBNB_RATINGS                                              │
│  ├─ Fire off bulk-scrape-airbnb-ratings                             │
│  ├─ Self-invoke to poll until complete                               │
│  └─ Transition to PROBABILITIES                                      │
│                                                                       │
│  Step 4: PROBABILITIES                                                │
│  ├─ Fire off calculate-all-probabilities                            │
│  ├─ Self-invoke to poll until complete                               │
│  └─ Transition to FORECASTS                                          │
│                                                                       │
│  Step 5: FORECASTS                                                    │
│  ├─ Fire off generate-all-forecasts                                  │
│  ├─ Self-invoke to poll until complete                               │
│  └─ Transition to ACTIONABLES                                        │
│                                                                       │
│  Step 6: ACTIONABLES                                                  │
│  ├─ Fire off generate-actionables                                    │
│  └─ Transition to COMPLETED                                          │
│                                                                       │
│  Step 7: COMPLETED                                                    │
│  └─ Log summary, update last_automated_sync timestamps               │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Database Changes

### New Table: `nightly_sync_runs`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| started_at | timestamptz | When the run started |
| completed_at | timestamptz | When the run completed |
| current_step | text | Current pipeline step |
| status | text | running / completed / failed |
| account_ids | text[] | Array of account IDs being processed |
| accounts_completed | text[] | Array of completed account IDs |
| step_results | jsonb | Results for each step |
| error_message | text | Error if failed |

## Implementation Details

### 1. State Machine Logic

The function will accept an optional `run_id` parameter:
- **No run_id**: Initialize new run, fire off account syncs, self-invoke
- **With run_id**: Check current state, determine next action, self-invoke if needed

### 2. Parallel Account Syncs

Since accounts have separate Guesty credentials and don't share rate limits:

```typescript
// Fire off ALL accounts in parallel (no waiting)
const syncPromises = accounts.map(account => 
  supabaseInvoke.functions.invoke('sync-guesty-data', {
    body: { accountId: account.id, syncType: 'listings' }
  })
);
await Promise.all(syncPromises); // Just fire them off
```

### 3. Self-Invocation Pattern

After firing off work or checking progress:

```typescript
// Check if more work needed
if (!allAccountsComplete) {
  // Self-invoke in 15 seconds to check again
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: runId }
  });
  return; // Exit this invocation
}
```

### 4. Per-Account Sequential Sync

Each account still needs sequential sync (listings → reservations → owners → calendar). We'll track this with a `current_sync_type` per account in the run state.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/nightly-sync/index.ts` | Rewrite with state machine pattern |
| Database migration | Add `nightly_sync_runs` table |

## Key Benefits

1. **No timeout**: Each invocation does work for ~30 seconds max, then self-invokes
2. **Parallel accounts**: Both accounts sync simultaneously (halves total time)
3. **Resilient**: State is persisted, so even if an invocation fails, the next one picks up
4. **Observable**: Clear progress tracking via the `nightly_sync_runs` table
5. **Debuggable**: Can inspect exactly which step failed and why

## Self-Invocation Limits

Edge functions can self-invoke, but we should add safeguards:
- Maximum invocation count per run (e.g., 100)
- Timeout after 2 hours total run time
- Error handling for failed self-invocations

