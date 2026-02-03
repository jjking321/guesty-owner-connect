

# Filter Calendar Sync to Active Listings Only

## Overview

Update the `sync-bulk-calendar` edge function to only sync calendar data for active, listed properties - matching the filtering pattern used by other sync functions.

---

## Current Problem

The bulk calendar sync currently queries listings with only:
```typescript
.eq('archived', false)
```

This syncs **772 listings** instead of just the **471 active listings**, wasting API calls and time on inactive properties that don't need calendar data.

---

## Solution

Add `is_listed = true` filter to match the pattern used in:
- `bulk-scrape-airbnb-ratings` 
- `generate-bulk-goals`

---

## Technical Change

**File:** `supabase/functions/sync-bulk-calendar/index.ts`

**Current code (lines 350-355):**
```typescript
const { data: listings, error: listingsError } = await supabase
  .from('listings')
  .select('id, nickname')
  .eq('guesty_account_id', guestyAccountId)
  .eq('archived', false)
  .order('nickname');
```

**Updated code:**
```typescript
const { data: listings, error: listingsError } = await supabase
  .from('listings')
  .select('id, nickname')
  .eq('guesty_account_id', guestyAccountId)
  .eq('is_listed', true)
  .eq('archived', false)
  .order('nickname');
```

---

## Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Listings synced | ~772 | ~471 | 39% fewer |
| Estimated sync time | ~6.5 min | ~4 min | 2.5 min faster |
| API calls | 772 | 471 | 301 fewer calls |

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-bulk-calendar/index.ts` | Add `.eq('is_listed', true)` filter to listings query |

