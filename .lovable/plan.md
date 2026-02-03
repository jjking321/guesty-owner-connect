

# Fix Query Limits and Pricing Comparison Data Source

## Problems Found

| Issue | Root Cause | Impact |
|-------|------------|--------|
| Missing goals still showing | Query hits 1000-row limit, only ~90 listings loaded | 429 false positives |
| No pricing actionables | Code uses `monthly_averages` (ends 2025-12) instead of `future_monthly_averages` (has 2026 data) | 0 pricing issues detected |
| Calendar data missing | 44,715 rows but default 1000 limit = only 15 listings get data | Unbookable gaps and pricing comparison broken for 682 listings |

---

## Fixes

### 1. Add Limit to Calendar Query (Line 199)

```typescript
// Calendar data for unbookable gaps AND pricing comparison
supabase
  .from('capacity_calendar')
  .select('listing_id, date, min_nights, is_available, price')
  .eq('is_available', true)
  .gte('date', today)
  .lte('date', ninetyDaysLater)
  .order('listing_id')
  .order('date')
  .limit(50000),  // Add limit to get all 44,715 rows
```

### 2. Switch Pricing Comparison to Use future_monthly_averages

The `monthly_averages` field has historical data ending at 2025-12, but calendar data is for 2026. Must use `future_monthly_averages` which has 2026 data.

**Update compset lookup (Line 302-311):**
```typescript
// Compset lookup - use future_monthly_averages which has 2026+ ADR data for pricing comparison
const compsetByListing = new Map<string, Array<{ month: string; adr: number; occupancy: number }>>();
if (compsetResult.data) {
  for (const row of compsetResult.data) {
    // Use future_monthly_averages for 2026+ pricing comparison
    const futureData = row.future_monthly_averages as Array<{ month: string; adr: number; occupancy: number }> || [];
    if (Array.isArray(futureData) && futureData.length > 0) {
      compsetByListing.set(row.listing_id, futureData);
    }
  }
}
```

### 3. Verify Goals Query Has Correct Limit

Confirmed already has `.limit(10000)` - this is correct.

---

## Data Validation

| Query | Current Rows | With Fix |
|-------|--------------|----------|
| Calendar (90 days) | 1,000 (15 listings) | 50,000 (all 697 listings) |
| Goals (2026, month >= 2) | 10,000 limit | Correct, 402 listings have goals |
| Compset future data | 32 listings have data | Use `future_monthly_averages` column |

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/generate-actionables/index.ts` | Add `.limit(50000)` to calendar query, change compset lookup to use `future_monthly_averages` |

---

## Expected Outcome

**After fix:**
- Calendar data loaded for all 697 active listings (not just 15)
- Unbookable gap detection works for all properties
- Pricing comparison uses 2026 compset ADR data (32 properties have data)
- Missing goals only shows properties truly without goal records

