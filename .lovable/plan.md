

# Plan: Show Private Note Under Review Text in Dispute Detail Sheet

## Overview

Display the private feedback/note from guests below the review text in the dispute detail sheet, matching the pattern already used in `ReviewManagementDialog.tsx`.

## Changes Required

### 1. Update DisputeReview Interface

**Files:** `src/components/dispute/DisputePipelineBoard.tsx` and `src/components/dispute/DisputeDetailSheet.tsx`

Add `private_note` field to the interface:

```typescript
interface DisputeReview {
  // ... existing fields
  private_note?: string | null;  // Add this field
}
```

The data is already being fetched since the query uses `select('*')`.

### 2. Add Private Note Display

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

Insert the private note section directly after the Review Text section (after line 395):

```typescript
{/* Review Text */}
<div>
  <Label className="text-sm font-medium">Review Text</Label>
  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
    {review.review_text || 'No review text available'}
  </p>
</div>

{/* Private Note - NEW */}
{review.private_note && (
  <div>
    <Label className="text-sm font-medium">Private Feedback</Label>
    <div className="mt-1 p-3 bg-muted/50 rounded-lg border border-border">
      <p className="text-sm whitespace-pre-wrap text-muted-foreground italic">
        {review.private_note}
      </p>
    </div>
  </div>
)}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputePipelineBoard.tsx` | Add `private_note` to DisputeReview interface (line 37) |
| `src/components/dispute/DisputeDetailSheet.tsx` | Add `private_note` to DisputeReview interface (line 101) and display section (after line 395) |

## Visual Appearance

The private note will appear:
- Below the review text
- With a "Private Feedback" label
- In a muted, bordered container
- With italic styling to distinguish from public content

This matches the existing styling pattern from `ReviewManagementDialog.tsx`.

