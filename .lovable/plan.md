

## Fix: Use Existing RPC for Historical Data

The data IS already pre-aggregated via `get_portfolio_night_metrics`. We don't need a new database function.

---

### Current Problem

The historical actuals query fetches **58,253 raw rows** from `reservation_nights`, hitting the 1000 row limit.

### Existing Solution

The `get_portfolio_night_metrics(p_year, p_month)` RPC already:
- Aggregates revenue by listing server-side
- Accepts any year (not just current)
- Returns ~250 rows per month (well under limit)

---

### Implementation

**File: `src/pages/GoalsReview.tsx`**

Replace the raw `reservation_nights` query (lines 81-97) with 12 parallel RPC calls:

```typescript
// Fetch historical actuals using existing RPC (12 parallel calls for each month)
const { data: historicalActuals = [] } = useQuery({
  queryKey: ["historical-actuals-rpc", selectedYear - 1],
  queryFn: async () => {
    const priorYear = selectedYear - 1;
    
    // Call RPC for each month in parallel
    const monthPromises = Array.from({ length: 12 }, (_, i) => 
      supabase.rpc('get_portfolio_night_metrics', {
        p_year: priorYear,
        p_month: i + 1
      })
    );
    
    const results = await Promise.all(monthPromises);
    
    // Combine results with month info
    const all: Array<{ listing_id: string; month: number; revenue: number }> = [];
    results.forEach((res, idx) => {
      if (res.error) throw res.error;
      res.data?.forEach((row: any) => {
        all.push({
          listing_id: row.listing_id,
          month: idx + 1,
          revenue: Number(row.actual_revenue) || 0
        });
      });
    });
    
    return all;
  },
});
```

Update the processing memo (lines 111-124):

```typescript
const historicalByListingMonth = useMemo(() => {
  const result: Record<string, Record<number, number>> = {};
  
  historicalActuals.forEach((row) => {
    if (!result[row.listing_id]) {
      result[row.listing_id] = {};
    }
    result[row.listing_id][row.month] = row.revenue;
  });
  
  return result;
}, [historicalActuals]);
```

---

### Why This Works

| Approach | Rows Returned | Within Limit? |
|----------|---------------|---------------|
| Raw query | 58,253 | No (1000 limit) |
| RPC per month | ~250 each × 12 calls | Yes |

---

### Changes Summary

| Location | Change |
|----------|--------|
| Lines 81-97 | Replace raw query with 12 parallel RPC calls |
| Lines 111-124 | Simplify processing for pre-aggregated data |

---

### Result

- All 291 listings with historical revenue will populate correctly
- LY column will show accurate monthly revenue
- Uses existing infrastructure (no new database functions)
- Faster queries (pre-aggregated server-side)

