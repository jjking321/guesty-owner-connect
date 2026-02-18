

# Fix Copy Goals Dialog - Statement Timeout

## Problem
The "Copy Goals from Another Property" dialog isn't loading all properties. The database logs show **statement timeouts** -- the query fetching all 5,500+ property goals with `.limit(50000)` is too slow because the RLS policy requires evaluating a join through `listings` and `guesty_accounts` for every row. The query times out before returning results, so most properties appear to have no goals and are hidden from the source list.

## Solution
Replace the single large goals query with the **batched fetching pattern** already used on the Goals Review and Bulk Edit pages. This fetches the listings first, then queries goals in small batches of 60 listing IDs using `.in("listing_id", batchIds)`, keeping each individual query fast and within the default row limit.

## Technical Details

**File:** `src/components/CopyGoalsFromPropertyDialog.tsx`

1. Make the goals query depend on the listings query results (use `listingIds` derived from the fetched listings).
2. Replace the single `property_goals` query with batched fetching:
   - Split listing IDs into chunks of 60
   - Run parallel queries: `.from("property_goals").select(...).eq("year", year).in("listing_id", batchIds)`
   - Merge all results
3. Remove the `.limit(50000)` since batching keeps each query under the default 1000-row limit (60 listings x 12 months = 720 rows max per batch).

This mirrors the exact pattern from `GoalsReview.tsx` (lines 46-78) and `PropertiesBulkEdit.tsx` (lines 165-195).

