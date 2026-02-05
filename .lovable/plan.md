
# Plan: Add Live Progress Tracking to Sync Reviews

## Overview
Add a real-time progress bar to the Reviews page that shows the status of the "Sync New Reviews" operation, matching the pattern used elsewhere in the app (like calendar sync and comparable data fetching).

## Current State
- The `sync-new-reviews` edge function **already tracks progress** in the `sync_jobs` table with:
  - `sync_type: 'new_reviews'`
  - `items_synced` count
  - `progress_message` updates
  - Status transitions (`running` → `completed`/`failed`)
- The `SyncProgressCard` component exists and supports this sync type
- The Reviews page only shows a button spinner, with no persistent progress visibility

## Changes Required

### 1. Update Reviews Page (`src/pages/Reviews.tsx`)

**Add import:**
```typescript
import { SyncProgressCard } from "@/components/SyncProgressCard";
```

**Add the SyncProgressCard component** below the header/action row, conditional on having a `guestyAccountId`:

```typescript
{guestyAccountId && (
  <SyncProgressCard
    accountId={guestyAccountId}
    syncType="new_reviews"
    onComplete={() => queryClient.invalidateQueries({ queryKey: ['reviews'] })}
  />
)}
```

**Remove the setTimeout refresh** in `handleSyncNewReviews` since the `SyncProgressCard` will handle data refresh via `onComplete`.

## Technical Details

### How Progress Tracking Works
1. When user clicks "Sync New Reviews", the edge function creates a `sync_jobs` record
2. `SyncProgressCard` subscribes to real-time Postgres changes on `sync_jobs`
3. As the edge function syncs pages of reviews, it updates `items_synced` and `progress_message`
4. The component displays a progress bar and live status messages
5. On completion/failure, the card shows final status and auto-dismisses after 30 seconds
6. The `onComplete` callback refreshes the reviews data

### User Experience
- Progress card appears when sync starts
- Shows: "Synced 45 new reviews (page 2)..."
- Displays item count badge (e.g., "45")
- Dismiss button available after completion
- Failed syncs show error message

## Visual Placement
The progress card will appear between the page header and the tabs, making it visible regardless of which tab (Guest Reviews or Airbnb Ratings) is active.

## Files Modified
| File | Change |
|------|--------|
| `src/pages/Reviews.tsx` | Add `SyncProgressCard` import and component, remove `setTimeout` refresh |
