
# Plan: Add Advanced Filters and Search to Reviews Page

## Overview

Add rating/score filter and text search capabilities to the Reviews page. Since the page uses server-side pagination, these filters will be applied at the database level to ensure accurate results across all pages.

## Current State

The Reviews page already has:
- Property filter (database-level)
- Date range filter (database-level)
- Platform filter (client-side, in ReviewsTable)
- Sort options (client-side, in ReviewsTable)

## Changes Required

### 1. Add New Filter State in Reviews.tsx

Add state for rating filter and search query:

| Filter | Type | Options |
|--------|------|---------|
| Rating | string | "all", "5", "4", "3", "2", "1", "low" (1-3 stars) |
| Search | string | Free text to search guest name and review text |

### 2. Update Filter Card UI

Expand the filter card to include:
- Rating dropdown with options: All Ratings, 5 Stars, 4 Stars, 3 Stars, 2 Stars, 1 Star, Low Ratings (1-3)
- Search input field with magnifying glass icon

### 3. Apply Filters to Database Queries

Update all three database queries to respect the new filters:

**Count Query:**
```typescript
if (ratingFilter !== 'all') {
  if (ratingFilter === 'low') {
    query = query.lte('rating', 3);
  } else {
    query = query.eq('rating', parseInt(ratingFilter));
  }
}
if (searchQuery) {
  query = query.or(`guest_name.ilike.%${searchQuery}%,review_text.ilike.%${searchQuery}%`);
}
```

**Paginated Reviews Query:**
Same filters applied.

**Summary Stats RPC:**
Update the `get_review_summary_stats` function call parameters or filter client-side for summary display.

### 4. Update Summary Stats RPC (Optional)

The RPC function `get_review_summary_stats` may need additional parameters for rating and search filtering. However, since summary stats typically show the full picture before filtering, we may keep it showing unfiltered data within the date/property range.

### 5. Debounce Search Input

Add a debounce (300-500ms) to the search input to avoid excessive database queries while typing.

## UI Layout

```text
+------------------------------------------------------------------+
| Filter                                                           |
| Filter reviews by property, date range, rating, or search        |
+------------------------------------------------------------------+
|                                                                  |
| [Property Dropdown ▼]  [Date Range ▼]  [Rating ▼]               |
|                                                                  |
| [🔍 Search guest name or review text...                    ]    |
|                                                                  |
+------------------------------------------------------------------+
```

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Reviews.tsx` | Add rating and search state, update queries, add UI elements |

## Technical Details

### Rating Filter Logic

```typescript
// In database queries
if (ratingFilter !== 'all') {
  if (ratingFilter === 'low') {
    // Low ratings: 1, 2, or 3 stars
    query = query.lte('rating', 3);
  } else {
    // Specific rating
    query = query.eq('rating', parseInt(ratingFilter));
  }
}
```

### Search Logic with Debounce

```typescript
const [searchInput, setSearchInput] = useState('');
const [searchQuery, setSearchQuery] = useState('');

// Debounce effect
useEffect(() => {
  const timer = setTimeout(() => {
    setSearchQuery(searchInput);
  }, 400);
  return () => clearTimeout(timer);
}, [searchInput]);

// In database query
if (searchQuery.trim()) {
  query = query.or(`guest_name.ilike.%${searchQuery}%,review_text.ilike.%${searchQuery}%`);
}
```

### Query Key Updates

All query keys need to include the new filter values:

```typescript
queryKey: ['reviews', 'paginated', selectedProperty, currentPage, 
           dateRange.from?.toISOString(), dateRange.to?.toISOString(),
           ratingFilter, searchQuery]
```

## Reset Page on Filter Change

When any filter changes, reset to page 1:

```typescript
useEffect(() => {
  setCurrentPage(1);
}, [selectedProperty, dateRange.from, dateRange.to, ratingFilter, searchQuery]);
```
