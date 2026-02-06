
# Fix: Scrollbar Spacing and Content Padding

## Problem

Looking at the screenshot, there are two issues:
1. **Weird space on the right of the scrollbar** - The `pr-10` on the sheet container pushes everything (including the scrollbar) away from the edge, creating an empty gap
2. **Text still cut off on the left of the scrollbar** - The inner content padding (`pr-6`) isn't sufficient to prevent text from running into the scrollbar

## Root Cause

The padding was added to the wrong element. Adding `pr-10` to the sheet container creates space between the scrollbar and the edge of the sheet, rather than between the content and the scrollbar.

## Solution

1. **Remove `pr-10` from the sheet container** - Let the scrollbar go to the natural edge
2. **Increase padding on the inner content div** - Change from `pr-6` to `pr-10` to give content more room from the scrollbar

## Changes Required

### 1. Remove padding from sheet container

**File:** `src/components/ui/sheet.tsx`

```typescript
// Line 40-41 - Before:
right:
  "inset-y-0 right-0 h-full w-3/4 border-l pr-10 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",

// After:
right:
  "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
```

### 2. Increase content padding

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

```typescript
// Line 371 - Before:
<div className="space-y-6 py-4 pr-6">

// After:
<div className="space-y-6 py-4 pr-10">
```

## Visual Result

- Scrollbar will sit at the natural edge of the sheet (no weird gap)
- Content will have 40px of padding from the scrollbar (enough room so text doesn't get cut off)
- The "59%" likelihood score and other edge content will display fully

## Files to Modify

| File | Change |
|------|--------|
| `src/components/ui/sheet.tsx` | Remove `pr-10` from right variant |
| `src/components/dispute/DisputeDetailSheet.tsx` | Change `pr-6` to `pr-10` on content div |
