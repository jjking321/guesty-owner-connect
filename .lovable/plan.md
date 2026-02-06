
# Fix: Category Ratings Layout - Keep All on One Line

## Problem

The Category Ratings section in the dispute detail sheet is wrapping to multiple lines. The 6th item (Communication) is appearing on a second row instead of staying on the same line as the other 5 categories.

## Root Cause

The container has `flex-wrap` which was added in a previous fix to prevent horizontal overflow. However, for Category Ratings specifically, the design intent is to have all items on one line.

## Solution

Remove `flex-wrap` and add proper constraints to keep all items on one line:

**File:** `src/components/dispute/DisputeDetailSheet.tsx`
**Line 414:**

```typescript
// Before:
<div className="mt-2 flex flex-wrap bg-muted/50 rounded-lg p-4">

// After:
<div className="mt-2 flex bg-muted/50 rounded-lg p-4 justify-between">
```

Also reduce padding on individual category items to ensure they fit:

**Lines 418-419:**
```typescript
// Before:
<div key={key} className="flex items-center">
  <div className="flex flex-col items-center px-4 text-center">

// After:
<div key={key} className="flex items-center flex-1">
  <div className="flex flex-col items-center flex-1 text-center">
```

## Summary of Changes

| Line | Change |
|------|--------|
| 414 | Remove `flex-wrap`, add `justify-between` for even spacing |
| 418 | Add `flex-1` to outer wrapper for equal distribution |
| 419 | Replace `px-4` with `flex-1` to let items size naturally |

## Expected Result

All 6 category ratings (Value, Checkin, Accuracy, Location, Cleanliness, Communication) will appear on a single row, evenly distributed across the container width.
