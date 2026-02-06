
# Add Real-Time Progress Bar for Bulk Dispute Analysis

## Overview
Add a status bar to the Dispute Pipeline Board that shows real-time progress when running "Analyze Triage" batch processing. This follows the same pattern used by the ForecastAdmin page and SyncProgressCard for progress tracking.

## Architecture

### Database
Create a new table `dispute_analysis_progress` to track batch analysis progress:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| started_at | timestamp | When the batch started |
| completed_at | timestamp | When the batch finished |
| status | text | running, completed, failed |
| total_reviews | int | Total reviews to process |
| completed_reviews | int | Successfully analyzed |
| failed_reviews | int | Failed to analyze |
| skipped_reviews | int | Skipped (no reservation_id, etc.) |
| current_guest_name | text | Guest name currently being processed |
| error_message | text | Error details if failed |

Enable realtime for this table so the frontend can subscribe to updates.

### Backend Changes
**File:** `supabase/functions/batch-analyze-disputes/index.ts`

1. At start: Create a progress record with status 'running'
2. Return the `progress_id` immediately to the frontend (fire-and-forget pattern)
3. After each review: Update the progress record with counts and current guest name
4. On completion: Update status to 'completed'
5. On error: Update status to 'failed' with error message

### Frontend Changes
**File:** `src/components/dispute/DisputePipelineBoard.tsx`

1. Add state for tracking progress:
   - `batchProgressId`: The ID returned from the edge function
   - `batchProgress`: Object with total, completed, failed, skipped, currentGuest

2. Subscribe to realtime updates on `dispute_analysis_progress` table

3. Show a progress UI below the filters when batch is running:
   - Progress bar with percentage
   - Text showing "Analyzing: [Guest Name]"
   - Counts: "3/10 completed, 1 skipped, 0 failed"
   - Cancel button to stop the batch

4. Auto-dismiss progress bar after completion (with brief success state)

## Visual Design

The progress section appears between the filters and the Kanban board:

```text
┌────────────────────────────────────────────────────────────────┐
│  🔄 Analyzing Disputes                              [Cancel]   │
│                                                                │
│  Currently analyzing: John Smith                               │
│  ████████████░░░░░░░░░░░░░░░░░░░░  35%                         │
│  3 completed · 1 skipped · 0 failed                            │
└────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Database Migration
Create `dispute_analysis_progress` table with RLS policies (service role only for writes, authenticated for reads).

Enable realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE dispute_analysis_progress;`

### Step 2: Update Edge Function
Modify `batch-analyze-disputes/index.ts`:
- Create progress record at start
- Return progress_id immediately
- Use async processing pattern (don't await the full loop before responding)
- Update progress after each review

### Step 3: Update Frontend
Modify `DisputePipelineBoard.tsx`:
- Add progress state management
- Subscribe to realtime channel for progress updates
- Render progress card when batch is running
- Handle completion and error states

## Files to Change

1. **New Migration**: Create `dispute_analysis_progress` table
2. **supabase/functions/batch-analyze-disputes/index.ts**: Add progress tracking
3. **src/components/dispute/DisputePipelineBoard.tsx**: Add progress UI with realtime subscription

## Technical Notes

- The edge function uses a "return early, process async" pattern - it returns the progress_id immediately so the UI can start subscribing, while processing continues
- Progress updates are written to the database after each review (not batched) for real-time visibility
- The frontend polls or subscribes via Supabase realtime to get updates
- Cancel functionality updates the progress status to 'cancelled', which the edge function checks between reviews
