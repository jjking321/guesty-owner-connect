

# Add Failure Notification to Last Auto Sync Display

## Overview

When the automated nightly sync encounters failures, users currently have no way to know unless they check the logs. This enhancement will add a visual indicator next to the "Last Auto Sync" timestamp showing if any sync operations failed, prompting users to try a manual sync.

## Current State

The Settings page shows:
```
Last Auto Sync: 2/2/2026, 12:50:37 PM
```

But there's no indication that the reservations sync failed with a statement timeout.

## Proposed Change

Show a warning badge when failures occurred:
```
Last Auto Sync: 2/2/2026, 12:50:37 PM ⚠️ Sync issues - try manual
```

## Implementation

### Step 1: Add State to Track Sync Failures

Add a new state variable to track which accounts had failures in their last automated sync:

```typescript
const [autoSyncFailures, setAutoSyncFailures] = useState<Record<string, string[]>>({});
```

### Step 2: Query for Failed Syncs

In `loadAccounts()`, after loading the accounts, query for failed sync jobs that occurred around each account's `last_automated_sync` time:

```typescript
// Check for failures in last automated sync
const { data: failedSyncs } = await supabase
  .from('sync_jobs')
  .select('guesty_account_id, sync_type, error_message')
  .in('guesty_account_id', accountIds)
  .eq('status', 'failed')
  .gte('started_at', /* last_automated_sync - 1 hour */)
  .lte('started_at', /* last_automated_sync + 1 minute */);
```

### Step 3: Update the Display

Modify the "Last Auto Sync" display section to show a warning when failures exist:

```tsx
{account.last_automated_sync && (
  <div className="flex items-center gap-1">
    <Clock className="h-3 w-3" />
    <span>Last Auto Sync: {new Date(account.last_automated_sync).toLocaleString()}</span>
    {autoSyncFailures[account.id]?.length > 0 && (
      <Badge variant="destructive" className="ml-1 text-xs">
        Sync issues
      </Badge>
    )}
  </div>
)}
```

Optionally show a tooltip or expand to show which specific syncs failed.

## Technical Details

| File | Changes |
|------|---------|
| `src/pages/Settings.tsx` | Add failure tracking state, query sync_jobs for failures, display warning badge |

### Query Logic

For each account with a `last_automated_sync` timestamp, find sync_jobs where:
- `guesty_account_id` matches the account
- `status = 'failed'`
- `started_at` is within a window around `last_automated_sync` (e.g., from 1 hour before to 1 minute after)

This captures all syncs that were part of the nightly run.

### UI Options

1. **Simple Badge**: Just show "Sync issues" badge
2. **Detailed Badge**: Show "1 of 4 syncs failed" 
3. **Expandable Details**: Show which specific sync types failed with their error messages

I recommend starting with option 2 (showing count) as it gives users enough information without being overwhelming.

## Expected Result

| Scenario | Display |
|----------|---------|
| All syncs succeeded | `Last Auto Sync: 2/2/2026, 12:50 PM` |
| 1 sync failed | `Last Auto Sync: 2/2/2026, 12:50 PM` + red badge "1 sync failed" |
| Multiple failures | `Last Auto Sync: 2/2/2026, 12:50 PM` + red badge "2 syncs failed" |

