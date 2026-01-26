

## Goals Review: Fix Missing Goals (1000 Row Limit)

The Goals Review page is missing goals because the Supabase query is hitting the **1000 row limit**. For 2026, there are 3,264 goal records (272 properties × 12 months), but only the first 1,000 are being returned.

---

### Root Cause

**GoalsReview.tsx (line 41-51)** fetches goals with a simple query:
```typescript
supabase.from("property_goals").select("*").eq("year", selectedYear)
```

This returns a maximum of 1,000 rows, cutting off 2,264 goals.

**PropertiesBulkEdit.tsx (lines 160-197)** correctly uses batched fetching:
```typescript
const BATCH_SIZE = 60; // 60 listings * 12 months = 720 rows < 1000
const chunks = []; // Split listingIds into batches
// Fetch each batch and combine results
```

---

### Fix

Update `src/pages/GoalsReview.tsx` to use the same batched fetching pattern:

1. **Get listing IDs first** - Create a derived list from the listings query
2. **Batch fetch goals** - Split listings into chunks of ~60, fetch goals for each batch
3. **Combine results** - Merge all batches into a single goals array

---

### Code Changes

**File: `src/pages/GoalsReview.tsx`**

| Line Range | Change |
|------------|--------|
| 26-38 | Keep listings query, add `listingIds` memo |
| 40-51 | Replace simple query with batched fetch using `listingIds` |

**Updated Goals Query:**
```typescript
// Derive listing IDs for batching
const listingIds = useMemo(() => listings.map(l => l.id), [listings]);

// Fetch goals in batches to avoid 1000 row limit
const { data: goals = [], refetch: refetchGoals } = useQuery({
  queryKey: ["property-goals", selectedYear, listingIds],
  enabled: listingIds.length > 0,
  queryFn: async () => {
    const BATCH_SIZE = 60; // 60 listings × 12 months = 720 rows < 1000
    const chunks: string[][] = [];
    for (let i = 0; i < listingIds.length; i += BATCH_SIZE) {
      chunks.push(listingIds.slice(i, i + BATCH_SIZE));
    }

    const promises = chunks.map((batchIds) =>
      supabase
        .from("property_goals")
        .select("*")
        .eq("year", selectedYear)
        .in("listing_id", batchIds)
    );

    const results = await Promise.all(promises);
    const all: any[] = [];
    for (const res of results) {
      if (res.error) throw res.error;
      if (res.data) all.push(...res.data);
    }

    console.log("Goals batched fetch:", {
      batches: chunks.length,
      listingCount: listingIds.length,
      goalsCount: all.length,
    });

    return all;
  },
});
```

---

### Additional Fix: Historical Actuals

The same 1000 row limit applies to the historical actuals query (line 53-69). For a year of reservation nights across 400+ properties, this could also hit the limit.

**Solution:** Use the existing `get_portfolio_night_metrics` RPC function for historical data, or implement batched fetching for reservation_nights as well.

---

### Result

After this fix:
- All 3,264 goals for 2026 will be fetched (currently only 1,000)
- Goals will match what appears on the Portfolio view
- Logging will confirm the batched fetch is working

