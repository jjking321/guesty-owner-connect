

# Fix Goals Query Hitting 1000-Row Limit

## Problem

The property "637 S Orlando #4" correctly has goals in the database for Feb, Mar, Apr 2026, but the actionables function is flagging it as "missing goals".

**Root Cause**: The goals query returns 4,422 records, but Supabase's default limit is 1,000 rows. Only ~90 listings' goals are being loaded (1000 rows / ~11 months avg = ~90 listings), leaving ~400+ listings without their goals in the lookup map.

## Current Code (Line 215-220)

```typescript
// Property goals - fetch ALL goal records for current year
supabase
  .from('property_goals')
  .select('listing_id, year, month, goal_revenue')
  .eq('year', currentYear)
  .gte('month', currentMonth),
```

This returns max 1,000 rows due to Supabase default limit.

## Fix

Add explicit limit to fetch all records (goal records are bounded by listings × months, so setting a high limit is safe):

```typescript
// Property goals - fetch ALL goal records for current year
// Explicitly set high limit since default is 1000 and we may have 4000+ records
supabase
  .from('property_goals')
  .select('listing_id, year, month, goal_revenue')
  .eq('year', currentYear)
  .gte('month', currentMonth)
  .limit(10000),
```

---

## File to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-actionables/index.ts` | Add `.limit(10000)` to goals query on line 220 |

---

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Goals loaded | ~1,000 rows (~90 listings) | ~4,422 rows (all listings) |
| False "missing goals" | ~400+ properties | Only properties truly missing goals |
| Properties flagged | 429 | Expected ~30-40 |

