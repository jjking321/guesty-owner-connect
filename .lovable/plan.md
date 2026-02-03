
# Add Date Filter and Fix Rating Display on Reviews Page

## Overview

This plan addresses two issues:
1. The "Overall Rating" stats only show data from the current page (100 reviews) instead of the full filtered dataset
2. Add a date filter that defaults to the last 30 days

---

## Changes Required

### 1. Add Date Filter with "Last 30 Days" Default

**File**: `src/components/DateRangeFilter.tsx`

Add a new preset for "Last 30 Days" and make it available as a preset type:

```typescript
export type DateRangePreset = "ytd" | "last365" | "lastWeek" | "lastMonth" | "last30" | "custom";

// Add to presets array:
{
  value: "last30",
  label: "Last 30 Days",
  getRange: () => ({
    from: subDays(new Date(), 29),
    to: new Date(),
  }),
},
```

---

### 2. Add Date Filter State to Reviews Page

**File**: `src/pages/Reviews.tsx`

Add date range state that defaults to last 30 days:

```typescript
import { subDays } from "date-fns";
import { DateRangeFilter, DateRange } from "@/components/DateRangeFilter";

const [dateRange, setDateRange] = useState<DateRange>({
  from: subDays(new Date(), 29),
  to: new Date(),
  preset: "last30",
});
```

Update the Filter card to include both property and date filters:

```jsx
<CardContent className="flex flex-wrap gap-4">
  <Select ... /> {/* existing property filter */}
  <DateRangeFilter value={dateRange} onChange={setDateRange} />
</CardContent>
```

---

### 3. Apply Date Filter to Database Queries

**File**: `src/pages/Reviews.tsx`

Update both the count query and paginated reviews query to filter by `review_date`:

```typescript
// In count query
if (dateRange.from && dateRange.to) {
  query = query
    .gte('review_date', dateRange.from.toISOString().split('T')[0])
    .lte('review_date', dateRange.to.toISOString().split('T')[0]);
}

// Same filter for paginated reviews query
```

Add `dateRange` to the query keys so data refreshes when dates change.

---

### 4. Fetch Full Summary Stats from Database

**File**: `src/pages/Reviews.tsx`

Create a new query to fetch aggregate review statistics for the full filtered dataset (not just current page):

```typescript
const { data: summaryStats } = useQuery({
  queryKey: ['reviews', 'summary', selectedProperty, dateRange],
  queryFn: async () => {
    // Fetch all reviews matching filters (with limited columns for performance)
    let query = supabase
      .from('reviews')
      .select('rating, source, is_removed, category_ratings')
      .eq('is_removed', false);
    
    // Apply property filter
    if (selectedProperty !== 'all') {
      query = query.eq('listing_id', selectedProperty);
    }
    
    // Apply date filter
    if (dateRange.from && dateRange.to) {
      query = query
        .gte('review_date', dateRange.from.toISOString().split('T')[0])
        .lte('review_date', dateRange.to.toISOString().split('T')[0]);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },
});
```

Pass this to `ReviewsSummary` instead of the paginated reviews:

```jsx
<ReviewsSummary reviews={summaryStats || []} />
```

---

### 5. Reset Pagination on Filter Changes

**File**: `src/pages/Reviews.tsx`

Update the existing useEffect to reset page when date range changes:

```typescript
useEffect(() => {
  setCurrentPage(1);
}, [selectedProperty, dateRange.from, dateRange.to]);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/DateRangeFilter.tsx` | Add "last30" preset for Last 30 Days |
| `src/pages/Reviews.tsx` | Add date filter state, update queries with date filtering, create separate summary stats query |

---

## Expected Outcome

After implementation:
1. **Date filter** appears in the Filter card with presets: Year to Date, Last 365 Days, Last 30 Days, Last 7 Days, Last Month, Custom Range
2. **Default view** shows reviews from the last 30 days
3. **Rating distribution** shows accurate stats for the entire filtered dataset, not just the current page
4. **All rating bars (1-5)** are visible even when counts are 0 (they already render but will now show correct totals)
5. **Pagination** applies to the filtered date range
