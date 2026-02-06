

# Plan: Real-Time UI Updates After AI Analysis

## Problem

When AI analysis completes, the UI doesn't immediately show the updated results. The current flow:
1. Analysis completes → `onUpdate()` called → `queryClient.invalidateQueries()` runs
2. Immediately tries to find updated review in `reviews` array  
3. But `reviews` still has stale data (query re-fetch is async)
4. User sees old data until they manually refresh or close/reopen the sheet

## Solution

Use React Query's refetch with await to ensure we get fresh data before updating the selected review state.

## Implementation

### File: `src/components/dispute/DisputePipelineBoard.tsx`

#### 1. Modify onUpdate to use async refetch

Change the `onUpdate` callback to await the refetch before updating `selectedReview`:

```typescript
onUpdate={async () => {
  // Wait for the query to refetch with fresh data
  const { data: freshReviews } = await refetch();
  
  // Now update selectedReview with the fresh data
  if (selectedReview && freshReviews) {
    const updated = freshReviews.find(r => r.id === selectedReview.id);
    if (updated) {
      setSelectedReview(updated);
    }
  }
}}
```

#### 2. Alternative: Use useEffect to sync selectedReview

Add a `useEffect` that automatically syncs `selectedReview` when the `reviews` data changes:

```typescript
// Sync selectedReview when reviews data updates
useEffect(() => {
  if (selectedReview && reviews.length > 0) {
    const updated = reviews.find(r => r.id === selectedReview.id);
    if (updated && JSON.stringify(updated) !== JSON.stringify(selectedReview)) {
      setSelectedReview(updated);
    }
  }
}, [reviews]);
```

This approach is more robust because:
- Works regardless of how the data is updated
- Automatically syncs whenever the query refetches
- No need to change the `onUpdate` callback logic

#### 3. Simplify onUpdate callback

With the useEffect handling sync, simplify onUpdate:

```typescript
onUpdate={() => {
  queryClient.invalidateQueries({ queryKey: ['dispute-reviews'] });
}}
```

## Technical Details

| Current Flow | New Flow |
|--------------|----------|
| onUpdate → invalidate → find in stale data | onUpdate → invalidate → useEffect detects change → update selectedReview |
| UI shows stale data | UI shows fresh data immediately |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputePipelineBoard.tsx` | Add useEffect to sync selectedReview when reviews data changes |

