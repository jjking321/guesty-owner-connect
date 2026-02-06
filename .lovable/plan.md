

# Fix: Red Flag Cards Text Cutoff

## Problem

The "Conversation Red Flags" cards (Irrelevant, Retaliatory) are being cut off on the right side. The quote text and context explanation run past the visible area of the card.

## Root Cause

The text elements inside the red flag cards don't have proper text wrapping classes applied:
- The `blockquote` element (showing the quoted message) lacks `break-words`
- The context `p` element lacks `break-words`
- The parent container has no overflow handling

## Solution

Add `break-words` class to both text elements to ensure long text wraps properly within the card boundaries.

## Changes Required

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

| Line | Element | Change |
|------|---------|--------|
| 775 | blockquote | Add `break-words` class |
| 779 | p (context) | Add `break-words` class |

### Code Changes

**Line 775 - Quote blockquote:**
```typescript
// Before:
<blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-sm text-muted-foreground mb-2">

// After:
<blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-sm text-muted-foreground mb-2 break-words">
```

**Line 779 - Context paragraph:**
```typescript
// Before:
<p className="text-sm">{flag.context}</p>

// After:
<p className="text-sm break-words">{flag.context}</p>
```

## Visual Result

- Quote text will wrap within the card instead of extending past the edge
- Context explanation will wrap properly
- All content will be fully visible within the card boundaries

## File to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add `break-words` to blockquote (line 775) and context paragraph (line 779) |

