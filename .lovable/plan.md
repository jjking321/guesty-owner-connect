

# Add More Padding to Dispute Detail Sheet

## Change

Increase the right padding on the content container from `pr-6` to `pr-8` to provide additional clearance for the content.

## File to Modify

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

**Line 371:**
```typescript
// Before:
<div className="space-y-6 py-4 pr-6">

// After:
<div className="space-y-6 py-4 pr-8">
```

This increases the right padding from 24px (pr-6) to 32px (pr-8), giving the content a bit more breathing room from the edge and scrollbar.

