

# Add Category Badge to Dispute Case File Section

## Objective

Add a violation category badge (Retaliatory, Irrelevant, Pressure, Competitor, Policy, None) to the Dispute Case File section header in the DisputeDetailSheet.

## Current State

The Dispute Case File section (lines 828-865) shows:
- Category Reason (textarea)
- Dispute Description (textarea with copy button)

The violation category is available in both:
- `review.dispute_violation_category` (database field)
- `caseFile.violation_category` (within the case file object)

## Solution

Add a Badge next to the "Dispute Case File" label showing the violation category.

## Change Required

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

**Lines 830-831** - Update the header to include a badge:

```typescript
// Before:
<div>
  <Label className="text-sm font-medium">Dispute Case File</Label>

// After:
<div>
  <div className="flex items-center gap-2">
    <Label className="text-sm font-medium">Dispute Case File</Label>
    {caseFile.violation_category && caseFile.violation_category !== 'None' && (
      <Badge variant="outline">{caseFile.violation_category}</Badge>
    )}
  </div>
```

## Visual Result

The section header will show:
> **Dispute Case File** `[Retaliatory]`

The badge will only appear if there's a valid violation category (not "None").

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add Badge next to "Dispute Case File" label (lines 830-831) |

