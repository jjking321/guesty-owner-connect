

# Bulk Copy Goals on Goals Review Page

## What exists
There's already a `CopyGoalsDialog` component that supports selecting a source property and multiple target properties. It's currently only used in the Group Detail page. We just need to wire it into the Goals Review page.

## Plan

1. **Add a "Copy Goals" button** to the Goals Review page action bar (next to Export CSV, Lock/Unlock buttons)
2. **Import and render `CopyGoalsDialog`** passing all filtered listing IDs and hooking `onSuccess` to `refetchGoals`
3. **Add search filtering** to the existing `CopyGoalsDialog` source list (it already has search in the `CopyGoalsFromPropertyDialog` but `CopyGoalsDialog` lacks it — will add for consistency since the portfolio has 272 properties)

### Files to modify
- `src/pages/GoalsReview.tsx` — add Copy Goals button + dialog state + render `CopyGoalsDialog`
- `src/components/CopyGoalsDialog.tsx` — add search input for source and target lists, use batched fetching for goals (currently no batching), fetch all listings instead of only those passed via `listingIds` prop (or accept all listing IDs from GoalsReview)

### Key detail
The `CopyGoalsDialog` currently takes a `listingIds` prop scoped to a group. For the Goals Review page, we'll pass all active listing IDs. The dialog's existing two-step flow (pick source, then pick targets with Select All/Deselect All) already handles the bulk use case well.

