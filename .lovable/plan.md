
# Fix: DisputeDetailSheet Content Overflow

## Problem

Content in the dispute detail sheet (opened when clicking a card) is overflowing the right boundary instead of wrapping:

1. **Category Ratings**: The 6-item horizontal flex layout (Value, Checkin, Accuracy, Location, Cleanliness, Communication) extends beyond the sheet boundary
2. **Conversation Summary and other text sections**: Text runs off the right edge and gets clipped

## Root Cause Analysis

The layout hierarchy is:
```text
SheetContent (sm:max-w-2xl = 672px)
└── ScrollArea (h-[calc(100vh-120px)])
    └── Viewport (w-full but no min-w-0)
        └── div.space-y-6.py-4.pr-10.overflow-hidden
            └── Category Ratings: flex (NO flex-wrap)
            └── Text sections (no min-w-0 in parent)
```

Two issues:
1. **Category Ratings flex container**: Uses `flex` without `flex-wrap`, causing horizontal overflow when content is too wide
2. **ScrollArea Viewport**: The Radix ScrollArea viewport uses `w-full` but in a flex context, children can still grow beyond their parent unless they have `min-w-0`. Without this, text content can push the container wider than intended.

## Solution

### 1. Category Ratings - Add flex-wrap

Add `flex-wrap` to the Category Ratings container so items wrap to a new line when they don't fit horizontally.

**File:** `src/components/dispute/DisputeDetailSheet.tsx`  
**Line 414:**

```typescript
// Before:
<div className="mt-2 flex bg-muted/50 rounded-lg p-4">

// After:
<div className="mt-2 flex flex-wrap bg-muted/50 rounded-lg p-4">
```

### 2. Main content container - Add min-w-0

Add `min-w-0` to the main content wrapper to ensure flex children can shrink below their content size.

**Line 371:**

```typescript
// Before:
<div className="space-y-6 py-4 pr-10 overflow-hidden">

// After:
<div className="space-y-6 py-4 pr-10 overflow-hidden min-w-0">
```

### 3. Text sections - Add explicit break-words

Ensure the review text and conversation summary paragraphs have `break-words` to handle long words/URLs.

**Line 393:**
```typescript
// Before:
<p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">

// After:
<p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">
```

**Line 403:**
```typescript
// Before:
<p className="text-sm whitespace-pre-wrap text-muted-foreground italic">

// After:
<p className="text-sm whitespace-pre-wrap break-words text-muted-foreground italic">
```

## Summary of Changes

| File | Line | Change |
|------|------|--------|
| `DisputeDetailSheet.tsx` | 371 | Add `min-w-0` to main content container |
| `DisputeDetailSheet.tsx` | 393 | Add `break-words` to review text paragraph |
| `DisputeDetailSheet.tsx` | 403 | Add `break-words` to private note paragraph |
| `DisputeDetailSheet.tsx` | 414 | Add `flex-wrap` to Category Ratings container |

## Visual Result

- Category Ratings will wrap to multiple rows when 6 items don't fit on one line
- All text content will properly wrap within the sheet boundaries
- No horizontal overflow in any section
