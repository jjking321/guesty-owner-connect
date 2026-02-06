
# Add Sort Options to Dispute Pipeline Board

## Overview
Add a dropdown to sort reviews within each Kanban column by either **Review Date** or **Removal Likelihood Score** (default).

## Changes

### File: `src/components/dispute/DisputePipelineBoard.tsx`

**1. Add sort state (after line 69)**
```typescript
const [sortBy, setSortBy] = useState<string>('likelihood');
```

**2. Add sort dropdown to filters row (after the Score filter, line 388)**

Add a new Select component for sorting:
```typescript
<Select value={sortBy} onValueChange={setSortBy}>
  <SelectTrigger className="w-[180px]">
    <SelectValue placeholder="Sort by..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="likelihood">Likelihood (High→Low)</SelectItem>
    <SelectItem value="date">Date (Newest First)</SelectItem>
  </SelectContent>
</Select>
```

**3. Update the grouping logic to apply sorting (lines 211-214)**

Replace the simple grouping with a sorted grouping:
```typescript
const reviewsByColumn = COLUMNS.reduce((acc, col) => {
  const columnReviews = reviews.filter(r => r.dispute_status === col.id);
  
  // Sort reviews within each column
  columnReviews.sort((a, b) => {
    if (sortBy === 'likelihood') {
      // Sort by likelihood score descending (nulls last)
      const scoreA = a.dispute_likelihood_score ?? -1;
      const scoreB = b.dispute_likelihood_score ?? -1;
      return scoreB - scoreA;
    } else {
      // Sort by date descending
      const dateA = a.review_date ? new Date(a.review_date).getTime() : 0;
      const dateB = b.review_date ? new Date(b.review_date).getTime() : 0;
      return dateB - dateA;
    }
  });
  
  acc[col.id] = columnReviews;
  return acc;
}, {} as Record<string, DisputeReview[]>);
```

**4. Add ArrowUpDown icon import (line 7)**
```typescript
import { Loader2, Sparkles, RefreshCw, Search, ArrowUpDown } from "lucide-react";
```

## Summary of Changes

| Location | Change |
|----------|--------|
| Line 69 | Add `sortBy` state with default `'likelihood'` |
| Line 7 | Import `ArrowUpDown` icon |
| Line 388 | Add sort dropdown after score filter |
| Lines 211-214 | Update grouping to sort within columns based on selected option |

## Behavior

- **Default**: Reviews sorted by Removal Likelihood (highest first)
- **Date option**: Reviews sorted by Review Date (newest first)
- Reviews with no likelihood score appear at the bottom when sorting by likelihood
- Sorting applies within each column independently
