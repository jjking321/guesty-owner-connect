

# Filter Airbnb Scrape to Active Listings Only

## Overview

Add a filter for `is_listed = true` to the bulk Airbnb ratings scraper so it only processes active listings. Currently 322 listings have an Airbnb ID, but only 225 are active.

---

## Current vs Expected Count

| Filter | Count |
|--------|-------|
| Has `airbnb_listing_id` + not archived | 322 |
| Has `airbnb_listing_id` + not archived + **is_listed = true** | **225** |

After the 24-hour skip filter, the final count should be around 225 or fewer.

---

## Technical Change

**File:** `supabase/functions/bulk-scrape-airbnb-ratings/index.ts`

Add `.eq("is_listed", true)` to the listings query at line 278-284:

```typescript
const { data: listings, error: listingsError } = await supabaseAdmin
  .from("listings")
  .select("id, nickname, airbnb_listing_id, live_rating_scraped_at")
  .in("guesty_account_id", guestyAccounts.map(a => a.id))
  .not("airbnb_listing_id", "is", null)
  .eq("archived", false)
  .eq("is_listed", true)  // <-- ADD THIS LINE
  .order("id");
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/bulk-scrape-airbnb-ratings/index.ts` | Add `is_listed = true` filter to query |

