

# Fix Subtotal Backfill: Switch to Bulk List API

## Problem

The database has **zero** reservations with a positive `sub_total` value (out of 61,965 total). The backfill function fetches individual reservations using `GET /v1/reservations/{id}?fields=money.subTotal`, but Guesty returns `null` for this field on individual lookups. The backfill then writes `0` for those (880 records got set to 0, 61,085 remain null).

The sync functions use the **bulk list endpoint** (`GET /v1/reservations?fields=...money.subTotal...`) which is known to return `subTotal` correctly. The backfill needs to use the same approach.

## Solution

Rewrite `supabase/functions/backfill-reservation-subtotals/index.ts` to use the bulk list endpoint instead of individual per-reservation API calls.

### Current approach (broken)
- Queries DB for reservation IDs with null `sub_total`
- Calls `GET /v1/reservations/{id}?fields=money.subTotal` per reservation (1 API call per record)
- Guesty returns null → function writes 0
- Extremely slow: ~5 records/second

### New approach
- Use `GET /v1/reservations` with filters for check-out date range, pagination (limit=100, skip=N)
- Request fields: `_id money.subTotal` (minimal payload)
- For each page of 100 results, batch-update `sub_total` in the database
- Match by reservation `_id` → update `sub_total` column
- Skip records where Guesty returns null/undefined (don't write 0)
- Self-invoke pattern preserved for large datasets

### Changes to `backfill-reservation-subtotals/index.ts`

1. **Remove** the `fetchReservationSubTotal` function (individual API calls)
2. **Add** a bulk fetch function using the list endpoint with pagination, mirroring the pattern in `sync-new-reservations`
3. **Filter** by check-out date range and use `filters` parameter (JSON array with `$gte`/`$lte` on `checkOut`)
4. **Process** results in bulk: for each page, collect `{id, subTotal}` pairs and batch-upsert to DB
5. **Only write** `sub_total` when the API returns a non-null value (stop setting null→0)
6. **First pass**: clear the 880 records that were incorrectly set to 0 back to null so they get re-processed
7. **Keep** the sync job tracking, self-invocation, and cancellation logic

### Additional: Reset incorrect zeros

Run a one-time data fix to reset the 880 records where `sub_total` was incorrectly set to `0` by the old backfill, so they get picked up by the new bulk backfill. This will be done via an INSERT/UPDATE query.

### Files to edit
- `supabase/functions/backfill-reservation-subtotals/index.ts` (major rewrite of data fetching logic)

### Performance improvement
- Old: ~5 reservations/second (1 API call each)
- New: ~500 reservations/second (100 per API call, with rate limit delays)
- Full 61k backfill: ~2 minutes vs ~3.5 hours

