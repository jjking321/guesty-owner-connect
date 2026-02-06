

# Fix: Dispute Detail Sheet Content Still Cutting Off

## Problem

Looking at the screenshot, the content is still being clipped on the right side:
- "Re-analyze" button text is cut off (shows "Re-analyz")
- "45" percentage is cut off (shows "4")
- Text in the conversation summary is running to the very edge

## Root Cause Analysis

The issue is that the base `p-6` padding in `sheetVariants` is being applied, but the ScrollArea and its content are not accounting for the close button (X) in the top-right corner. The content needs more right padding to avoid the close button and the scrollbar.

| Issue | Location | Description |
|-------|----------|-------------|
| Base padding too tight | `sheet.tsx` line 32 | `p-6` provides equal padding, but right side needs more for close button |
| ScrollArea padding | `DisputeDetailSheet.tsx` line 370 | `pr-6` may not be enough with the scrollbar |
| Content container | `DisputeDetailSheet.tsx` line 371 | `pr-2` too small |

## Solution

Increase padding on the content area to provide adequate clearance:

### 1. Update ScrollArea and Content Container

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

Increase the right padding on both the ScrollArea and inner container:

```typescript
// Line 370-371 - Before:
<ScrollArea className="h-[calc(100vh-120px)] pr-6">
  <div className="space-y-6 py-4 pr-2 overflow-hidden">

// After:
<ScrollArea className="h-[calc(100vh-120px)]">
  <div className="space-y-6 py-4 pr-6">
```

Moving the padding from the ScrollArea to the inner div ensures the content has proper spacing while the scrollbar stays at the edge.

### 2. Ensure flex items don't overflow

The "AI Dispute Analysis" header with the "Re-analyze" button uses `justify-between` which can cause issues. Add `min-w-0` to allow flex items to shrink:

```typescript
// Line 442 - Before:
<div className="flex items-center justify-between mb-3">

// After:
<div className="flex items-center justify-between mb-3 gap-2">
```

Adding `gap-2` ensures minimum spacing between label and button.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Adjust padding: move `pr-6` from ScrollArea to inner div, remove `overflow-hidden`, add gap to flex container |

## Summary of Changes

1. Move right padding from `ScrollArea` to the inner content `div`
2. Increase padding from `pr-2` to `pr-6` on the content container
3. Remove `overflow-hidden` which was constraining content
4. Add `gap-2` to the flex container with the Re-analyze button

