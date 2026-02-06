

# Plan: Add Advanced Filters and Search to Dispute Pipeline Board

## Overview

Enhance the Dispute Pipeline Board with additional filtering capabilities: date range filter, rating/likelihood score filter, and text search. These filters will apply at the database level before grouping reviews into Kanban columns.

## Current State

The DisputePipelineBoard currently has:
- Property filter (database-level) ✅
- Refresh and Analyze Triage buttons ✅
- Badge counts for total disputes and high priority ✅

Missing:
- Date range filter
- Rating/Score filter
- Text search

## Changes Required

### 1. Add New Filter State

| Filter | Type | Description |
|--------|------|-------------|
| `dateRange` | `{ from: Date \| undefined, to: Date \| undefined }` | Filter by review_date |
| `ratingFilter` | `string` | "all", "1", "2", "3", or "low" (already < 4 for disputes, so these are refinements within 1-3 stars) |
| `scoreFilter` | `string` | "all", "high" (>=70%), "medium" (30-69%), "low" (<30%), "unanalyzed" |
| `searchInput` | `string` | Raw input value |
| `searchQuery` | `string` | Debounced value for querying |

### 2. Update Filter UI

Reorganize the header to include a more comprehensive filter bar:

```text
Row 1: [Property ▼] [Date Range ▼] [Rating ▼] [Score ▼]
Row 2: [🔍 Search guest name or review text...              ] | Badges | Buttons
```

### 3. Apply Filters to Database Query

Update the main reviews query to include all filters:

```typescript
let query = supabase
  .from('reviews')
  .select('*')
  .eq('is_removed', false)
  .ilike('source', '%airbnb%')
  .lt('rating', 4)
  .not('dispute_status', 'is', null)
  .order('review_date', { ascending: false });

// Property filter
if (selectedProperty !== 'all') {
  query = query.eq('listing_id', selectedProperty);
}

// Date range filter
if (dateRange.from) {
  query = query.gte('review_date', dateRange.from.toISOString());
}
if (dateRange.to) {
  query = query.lte('review_date', dateRange.to.toISOString());
}

// Rating filter (within the 1-3 stars already filtered)
if (ratingFilter !== 'all') {
  query = query.eq('rating', parseInt(ratingFilter));
}

// Score filter
if (scoreFilter === 'high') {
  query = query.gte('dispute_likelihood_score', 70);
} else if (scoreFilter === 'medium') {
  query = query.gte('dispute_likelihood_score', 30).lt('dispute_likelihood_score', 70);
} else if (scoreFilter === 'low') {
  query = query.lt('dispute_likelihood_score', 30).not('dispute_likelihood_score', 'is', null);
} else if (scoreFilter === 'unanalyzed') {
  query = query.is('dispute_likelihood_score', null);
}

// Search filter
if (searchQuery.trim()) {
  query = query.or(`guest_name.ilike.%${searchQuery}%,review_text.ilike.%${searchQuery}%`);
}
```

### 4. Add Debounced Search

```typescript
const [searchInput, setSearchInput] = useState('');
const [searchQuery, setSearchQuery] = useState('');

useEffect(() => {
  const timer = setTimeout(() => {
    setSearchQuery(searchInput);
  }, 400);
  return () => clearTimeout(timer);
}, [searchInput]);
```

### 5. Update Query Keys

Include all filter values in the query key for proper cache invalidation:

```typescript
queryKey: ['dispute-reviews', selectedProperty, 
           dateRange.from?.toISOString(), dateRange.to?.toISOString(),
           ratingFilter, scoreFilter, searchQuery]
```

## UI Layout

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ [Property ▼]  [Date Range ▼]  [Rating ▼]  [Likelihood ▼]                       │
│                                                                                 │
│ [🔍 Search guest name or review text...                    ]                   │
│                                                                                 │
│ [12 disputes] [3 high priority]                    [Refresh] [Analyze Triage] │
└─────────────────────────────────────────────────────────────────────────────────┘
│ Triage │ Analyzing │ Not Eligible │ Submit Claim │ Submitted │ Pending │ Resolved │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Filter Options

### Rating Filter
| Value | Label | Query |
|-------|-------|-------|
| `all` | All Ratings | No additional filter (already < 4) |
| `3` | 3 Stars | `.eq('rating', 3)` |
| `2` | 2 Stars | `.eq('rating', 2)` |
| `1` | 1 Star | `.eq('rating', 1)` |

### Likelihood Score Filter
| Value | Label | Query |
|-------|-------|-------|
| `all` | All Scores | No filter |
| `high` | High (70%+) | `.gte('dispute_likelihood_score', 70)` |
| `medium` | Medium (30-69%) | `.gte(..., 30).lt(..., 70)` |
| `low` | Low (<30%) | `.lt(..., 30).not(..., 'is', null)` |
| `unanalyzed` | Not Analyzed | `.is('dispute_likelihood_score', null)` |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputePipelineBoard.tsx` | Add filter state, UI components, update query |

## Technical Considerations

1. **Imports**: Add `Search` icon from lucide-react, import `StripeDateRangePicker` and `Input` components

2. **Date Range Initialization**: Default to "All time" (undefined/undefined) to show all disputes

3. **Layout**: Use a responsive grid layout for filters that wraps on smaller screens

4. **Performance**: The debounced search prevents excessive queries while typing

