

# Fix: All Sheet Sections Text Overflow/Clipping

## Problem

Multiple sections in the DisputeDetailSheet are having text overflow issues where content extends past the visible area:

1. **Conversation History** - Message bubbles with URLs/long text extend past bounds
2. **Conversation Red Flags** - Overall assessment and red flag cards clip at the right edge  
3. **Dispute Case File** - Textarea content and descriptions are cut off

## Root Cause

The ScrollArea component wraps content in a viewport that doesn't constrain child widths properly. While `pr-10` was added to the inner div, individual elements inside nested containers (like the conversation ScrollArea, red flag cards, textareas, etc.) don't inherit proper width constraints and can overflow their parents.

## Solution

Apply `overflow-hidden` to the main content container to enforce width boundaries, and add `break-words` and width constraints to specific problematic elements:

1. Add `overflow-hidden` to the main content container to clip any overflow
2. Add `w-full` and `overflow-hidden` to nested containers that need width constraints
3. Ensure textareas and paragraphs have proper `break-words` handling

## Changes Required

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

### 1. Add overflow-hidden to main content div (line 371)

```typescript
// Before:
<div className="space-y-6 py-4 pr-10">

// After:
<div className="space-y-6 py-4 pr-10 overflow-hidden">
```

### 2. Fix nested conversation ScrollArea container (line 573)

```typescript
// Before:
<div className="space-y-3 pr-4">

// After:
<div className="space-y-3 pr-4 overflow-hidden">
```

### 3. Fix overall assessment paragraph (line 717)

```typescript
// Before:
<p className="text-sm bg-muted/50 p-3 rounded-lg">

// After:
<p className="text-sm bg-muted/50 p-3 rounded-lg break-words">
```

### 4. Fix red flag card container (lines 727-735)

```typescript
// Before:
<div
  key={idx}
  className={cn(
    "p-3 rounded-lg border-l-4 relative",

// After:
<div
  key={idx}
  className={cn(
    "p-3 rounded-lg border-l-4 relative overflow-hidden",
```

### 5. Fix dialog conversation container (line 614)

```typescript
// Before:
<div className="space-y-4">

// After:
<div className="space-y-4 overflow-hidden">
```

### 6. Fix message content in dialog (line 633)

```typescript
// Before:
<p className="whitespace-pre-wrap">{msg.content}</p>

// After:
<p className="whitespace-pre-wrap break-words">{msg.content}</p>
```

## Visual Result

- All message bubbles will properly wrap long URLs and text
- Overall assessment text will stay within bounds
- Red flag quotes and context will not extend past cards
- Dispute description textarea content will be properly contained
- No horizontal overflow in any section

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add overflow-hidden and break-words classes to 6 locations |

