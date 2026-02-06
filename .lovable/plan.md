

# Fix: Dispute Detail Sheet Sidebar Content Cutoff

## Problem

The review dispute detail sheet (side panel) is cutting off content on the right side. Text in sections like "Conversation Summary" and message content is being truncated before reaching the edge of the panel.

## Root Causes

| Issue | Location | Description |
|-------|----------|-------------|
| CSS class conflict | `sheet.tsx` line 40-41 | The `sheetVariants` includes `sm:max-w-sm` which may override the custom `sm:max-w-2xl` |
| Missing overflow control | `DisputeDetailSheet.tsx` line 369 | ScrollArea's inner content needs explicit overflow handling |
| Word wrapping | Various text elements | Long text content may not be breaking properly |

## Solution

### 1. Update SheetContent to remove conflicting max-width

**File:** `src/components/ui/sheet.tsx`

Change the `sheetVariants` for the `right` side to not include `sm:max-w-sm`, allowing custom className overrides to work:

```typescript
// Before:
right: "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",

// After:
right: "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
```

This allows the `DisputeDetailSheet` to properly override with `sm:max-w-2xl`.

### 2. Add overflow handling to ScrollArea content

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

Add `overflow-hidden` to the content container and ensure text breaks properly:

```typescript
// Line 369-370:
<ScrollArea className="h-[calc(100vh-120px)] pr-6">
  <div className="space-y-6 py-4 pr-2">
```

Changes:
- Increase `pr-4` to `pr-6` on ScrollArea to give more room for the scrollbar
- Add `pr-2` to inner div for additional content padding

### 3. Fix text overflow on long content sections

Add `break-words` and `overflow-wrap` to text-heavy sections:

```typescript
// Conversation summary (around line 501-510)
<p className="text-sm text-muted-foreground break-words">
  {review.dispute_conversation_summary}
</p>

// Message content in conversation history
<p className="text-sm break-words">
  {message.body || message.text}
</p>
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/ui/sheet.tsx` | Remove `sm:max-w-sm` from right variant to allow override |
| `src/components/dispute/DisputeDetailSheet.tsx` | Increase ScrollArea padding, add `break-words` to text elements |

## Summary

The fix involves:
1. Removing the conflicting `sm:max-w-sm` from the sheet component's right variant
2. Adding proper padding to accommodate the scrollbar
3. Ensuring long text content wraps properly with `break-words`

