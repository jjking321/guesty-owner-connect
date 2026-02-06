
# Fix: Guest Name/Date Cut Off in Dispute Detail Sheet

## Problem

In the Dispute Detail Sheet header, the guest name and date line (e.g., "Nick Boroughf • 1/27/2026") is being cut off. This happens because:
1. The close button (X) is positioned at `right-4 top-4`, overlapping the header area
2. The `SheetDescription` has no width constraint or text overflow handling
3. Longer guest names collide with the close button

Meanwhile, shorter names like "Soner Keser" fit fine.

## Solution

Add right padding to the `SheetHeader` in the DisputeDetailSheet to make room for the close button, and add text overflow handling to prevent clipping.

## Changes Required

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

### 1. Add padding to SheetHeader (line 356)

```typescript
// Before:
<SheetHeader>

// After:
<SheetHeader className="pr-8">
```

This adds 32px of right padding to keep the header content clear of the close button.

### 2. Add truncate class to SheetDescription content (line 365-367)

Wrap the description text to ensure it truncates gracefully if still too long:

```typescript
// Before:
<SheetDescription>
  {review.guest_name || 'Unknown Guest'} • {review.review_date ? new Date(review.review_date).toLocaleDateString() : 'Unknown date'}
</SheetDescription>

// After:
<SheetDescription className="truncate">
  {review.guest_name || 'Unknown Guest'} • {review.review_date ? new Date(review.review_date).toLocaleDateString() : 'Unknown date'}
</SheetDescription>
```

## Visual Result

- The guest name and date will have proper clearance from the close button
- If the combined text is still too long, it will truncate with an ellipsis rather than being abruptly cut off
- All guest names will display consistently without overlapping the X button

## File to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add `pr-8` to SheetHeader (line 356), add `truncate` class to SheetDescription (line 365) |
