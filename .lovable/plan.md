
# Fix: "No Reviews to Process" Despite 46 Visible in Triage

## Problem
When clicking "Analyze Triage" button, the edge function returns "No reviews in triage to process" even though 46 reviews are visible in the triage column.

## Root Cause
There's a date mismatch between what the frontend shows and what the backend processes:

| Component | Date Filter | Result |
|-----------|------------|--------|
| Kanban board query | **None** | Shows all 46 triage reviews |
| Edge function | `review_date >= (today - 30 days)` | Filters out **all** reviews |

Your most recent triage review is from **January 6, 2026** - exactly 31 days ago, so everything gets excluded.

## Solution
Remove the date filter from the edge function entirely. If a review is visible in the triage column and the user wants to analyze it, we should process it regardless of age. The frontend already determines what's relevant by showing it.

## Changes Required

**File:** `supabase/functions/batch-analyze-disputes/index.ts`

### Remove the maxAgeDays filter (Lines 30-39)

```typescript
// Before:
const { limit = 10, skipWithoutReservation = false, maxAgeDays = 7 } = await req.json()...

// Calculate cutoff date for recent reviews only
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

let query = supabase
  .from('reviews')
  .select('id, guest_name, reservation_id, listing_id, review_date')
  .eq('dispute_status', 'triage')
  .gte('review_date', cutoffDate.toISOString())  // <-- This excludes everything
  ...

// After:
const { limit = 10, skipWithoutReservation = false } = await req.json()...

let query = supabase
  .from('reviews')
  .select('id, guest_name, reservation_id, listing_id, review_date')
  .eq('dispute_status', 'triage')
  // No date filter - analyze any review in triage
  ...
```

**File:** `src/components/dispute/DisputePipelineBoard.tsx`

### Remove maxAgeDays from the function call (Line 283)

```typescript
// Before:
body: { 
  limit: Math.min(triageReviews.length, 20),
  maxAgeDays: 30,
}

// After:
body: { 
  limit: Math.min(triageReviews.length, 20),
}
```

## Why This Approach
- If a review is in triage and visible to the user, they should be able to analyze it
- Old reviews might still be eligible for dispute (Airbnb allows disputes within certain timeframes)
- The UI already filters what's shown via the date range picker if the user wants to narrow down
