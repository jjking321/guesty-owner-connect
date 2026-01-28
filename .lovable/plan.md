
# Make Resume Sync Option Persistent

## Problem
When a sync job fails with progress to resume from (`last_synced_offset > 0`), the Resume option disappears because:
1. The card auto-clears after 30 seconds
2. On page reload, only jobs from the last 5 minutes are shown
3. Once dismissed, there's no way to get the Resume button back

This is frustrating when syncing 27k records and the job fails at 21k - you lose the ability to resume.

## Solution
Always show resumable failed jobs (those with `last_synced_offset > 0`) regardless of time, and never auto-dismiss them. Only hide them when the user explicitly dismisses OR when a new sync completes successfully.

## Changes

### 1. SyncProgressCard.tsx - Update job loading logic

**On mount loading (lines 48-86):**
- Add a third query specifically for "resumable" failed jobs (no time limit)
- Check for resumable jobs: `status = 'failed'` AND `last_synced_offset > 0`
- Priority order: running > resumable failed > recent completed

**Realtime subscription (lines 108-121):**
- Don't auto-clear failed jobs that have `last_synced_offset > 0`
- Only auto-clear completed jobs and non-resumable failed jobs

**Resume handlers:**
- After successful resume, the new running job will naturally replace the failed one

### 2. Updated Logic Flow

```text
On page load:
  1. Check for running job -> Show with Stop button
  2. Check for resumable failed job (any age) -> Show with Resume button  
  3. Check for recent completed/failed (5 min) -> Show briefly then auto-clear

On job status change:
  - Running: Show with Stop button
  - Completed: Auto-clear after 30s
  - Failed + offset > 0: Keep showing with Resume button (no auto-clear)
  - Failed + offset = 0: Auto-clear after 30s
```

### 3. Sync types that support resume
- `reservations` - Uses `last_synced_offset` 
- `capacity_calendar` - Uses resume logic (already persistent)

---

## Technical Details

### File: `src/components/SyncProgressCard.tsx`

**Change 1: Add query for resumable jobs on mount**
```typescript
// After checking for running job, before checking recent jobs:
// Check for resumable failed jobs (no time limit)
const { data: resumableJob } = await supabase
  .from('sync_jobs')
  .select('*')
  .eq('guesty_account_id', accountId)
  .eq('sync_type', syncType)
  .eq('status', 'failed')
  .gt('last_synced_offset', 0)
  .order('started_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (resumableJob) {
  setSyncJob(resumableJob as SyncJob);
  setDismissed(false);
  return; // Don't auto-clear resumable jobs
}
```

**Change 2: Update realtime auto-clear logic**
```typescript
// In the realtime subscription callback:
if (job.status === 'completed' || job.status === 'completed_with_errors') {
  // Auto-clear completed jobs
  setTimeout(() => setSyncJob(null), 30000);
} else if (job.status === 'failed') {
  // Only auto-clear failed jobs that can't be resumed
  if (!job.last_synced_offset || job.last_synced_offset === 0) {
    setTimeout(() => setSyncJob(null), 30000);
  }
  // Resumable failed jobs stay visible until dismissed or resumed
}
```

**Change 3: Show progress info for failed resumable jobs**
```typescript
// Update showProgress to also show for resumable failed jobs
const canResume = isFailed && syncJob.last_synced_offset && syncJob.last_synced_offset > 0;
const showProgress = (syncJob.status === 'running' || canResume) && 
  (syncJob.items_synced !== null || syncJob.total_items !== null);
```

## Testing
1. Start a reservations sync, let it reach ~5000 records
2. Click Stop to cancel it
3. Refresh the page - Resume button should still appear
4. Wait 10+ minutes, refresh again - Resume button should still be there
5. Click Resume - sync should continue from the offset
6. After completion, the card should auto-dismiss normally
