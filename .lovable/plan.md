

# Add Airbnb Ratings Tab to Reviews Page

## Overview

Add a toggle tab to the Reviews page that allows users to switch between:
1. **Guest Reviews** (current view) - Reviews synced from Guesty
2. **Airbnb Ratings** (new view) - Live scraped ratings from Airbnb listings

The Airbnb Ratings tab will display a sortable table of all listings with their scraped ratings, with the ability to sort low-to-high and include links to Airbnb.

---

## Data Available

From the `listings` table:
- `nickname` - Property name
- `airbnb_listing_id` - Used to construct Airbnb link
- `live_airbnb_rating` - Scraped rating (e.g., 4.67)
- `live_airbnb_review_count` - Number of reviews on Airbnb
- `live_rating_scraped_at` - When the rating was last scraped

Current data: 225 active listings with Airbnb IDs, 57 already have scraped ratings.

---

## UI Design

```text
+------------------------------------------------------------------+
| Reviews Management                        [Sync New Reviews]     |
| View and manage reviews across all properties                    |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| [Guest Reviews]  [Airbnb Ratings]    <- Tab toggle               |
+------------------------------------------------------------------+

When "Airbnb Ratings" is selected:

+------------------------------------------------------------------+
| Airbnb Live Ratings                                              |
| Sort: [Low to High ▼]                     57 of 225 properties   |
+------------------------------------------------------------------+
| Property          | Rating | Reviews | Last Scraped | Airbnb    |
|-------------------|--------|---------|--------------|-----------|
| 141 California #2 | ★ 4.67 | 72      | 2 hours ago  | [Link]    |
| 402 S Orlando #3  | ★ 4.69 | 62      | 2 hours ago  | [Link]    |
| ...               |        |         |              |           |
+------------------------------------------------------------------+
```

---

## Technical Implementation

### 1. Add Tabs to Reviews Page

**File:** `src/pages/Reviews.tsx`

- Add `useState` for active tab: `"reviews" | "airbnb-ratings"`
- Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from ui/tabs
- Wrap existing content in `TabsContent value="reviews"`
- Add new `TabsContent value="airbnb-ratings"` with the new component

### 2. Create New Component: AirbnbRatingsTable

**File:** `src/components/AirbnbRatingsTable.tsx` (new file)

Features:
- Fetches listings with `airbnb_listing_id IS NOT NULL`, `is_listed = true`, `archived = false`
- Displays in a sortable table with columns: Property, Rating, Reviews, Last Scraped, Airbnb Link
- Sort toggle: "Low to High" / "High to Low" (defaults to Low to High as requested)
- Shows count of properties with ratings vs total
- Airbnb link opens in new tab with external link icon
- Uses AirbnbIcon for branding

---

## Component Structure

```typescript
// src/components/AirbnbRatingsTable.tsx

interface AirbnbRating {
  id: string;
  nickname: string;
  airbnb_listing_id: string;
  live_airbnb_rating: number | null;
  live_airbnb_review_count: number | null;
  live_rating_scraped_at: string | null;
}

// Sort options
type SortOrder = 'low-to-high' | 'high-to-low';

export function AirbnbRatingsTable() {
  const [sortOrder, setSortOrder] = useState<SortOrder>('low-to-high');
  
  // Fetch listings with Airbnb IDs
  const { data: listings } = useQuery({...});
  
  // Sort by rating
  const sortedListings = [...listings].sort((a, b) => {
    if (sortOrder === 'low-to-high') {
      return (a.live_airbnb_rating ?? 5) - (b.live_airbnb_rating ?? 5);
    }
    return (b.live_airbnb_rating ?? 0) - (a.live_airbnb_rating ?? 0);
  });
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AirbnbIcon className="h-5 w-5 text-[#FF385C]" />
            Airbnb Live Ratings
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectItem value="low-to-high">Low to High</SelectItem>
              <SelectItem value="high-to-low">High to Low</SelectItem>
            </Select>
            <span className="text-sm text-muted-foreground">
              {withRatingCount} of {totalCount} properties scraped
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          {/* Property, Rating, Reviews, Last Scraped, Airbnb Link */}
        </Table>
      </CardContent>
    </Card>
  );
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/AirbnbRatingsTable.tsx` | **Create** | New table component for displaying scraped Airbnb ratings |
| `src/pages/Reviews.tsx` | **Modify** | Add tabs to switch between Guest Reviews and Airbnb Ratings |

---

## Query for Airbnb Ratings

```typescript
const { data: listings } = useQuery({
  queryKey: ['airbnb-ratings'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('listings')
      .select('id, nickname, airbnb_listing_id, live_airbnb_rating, live_airbnb_review_count, live_rating_scraped_at')
      .not('airbnb_listing_id', 'is', null)
      .eq('is_listed', true)
      .eq('archived', false)
      .order('nickname');
    
    if (error) throw error;
    return data || [];
  },
});
```

---

## Table Columns

| Column | Data Source | Notes |
|--------|-------------|-------|
| Property | `nickname` | Property name, links to property detail |
| Rating | `live_airbnb_rating` | Shows "Not scraped" if null, otherwise stars + number |
| Reviews | `live_airbnb_review_count` | Count of reviews on Airbnb |
| Last Scraped | `live_rating_scraped_at` | Uses `formatDistanceToNow` for relative time |
| Airbnb | `airbnb_listing_id` | External link icon, opens `airbnb.com/rooms/{id}` |

---

## Sorting Logic

Default sort order is **Low to High** as requested, which helps identify properties with lower ratings that may need attention:

```typescript
const sortedListings = [...listings].sort((a, b) => {
  const ratingA = a.live_airbnb_rating;
  const ratingB = b.live_airbnb_rating;
  
  // Properties without ratings go to the end
  if (ratingA === null && ratingB === null) return 0;
  if (ratingA === null) return 1;
  if (ratingB === null) return -1;
  
  if (sortOrder === 'low-to-high') {
    return ratingA - ratingB;
  }
  return ratingB - ratingA;
});
```

