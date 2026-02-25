

# Why the Backfill Skipped All 1,021 Reservations

## Root Cause

The Guesty API is not returning `money.subTotal` when only `_id money.subTotal` is requested in the `fields` parameter. The working sync functions (e.g., `sync-new-reservations`) request **all** money sub-fields together:

```
fields: '_id status checkIn checkOut ... money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue money.totalTaxes money.subTotal'
```

The backfill function requests only:

```
fields: '_id money.subTotal'
```

Guesty's API appears to not populate the `money` object at all when only a single nested sub-field is requested in isolation. Every reservation came back with `money` as `undefined` or `null`, so the function correctly skipped all 1,021 records (the "skip if null" logic working as designed).

## Fix

In `supabase/functions/backfill-reservation-subtotals/index.ts`, change the `fields` parameter in `fetchReservationPage` (line 143) to request the full set of money fields, matching the working sync pattern. Also add a diagnostic log on the first page to confirm data is coming through.

### Changes

**File: `supabase/functions/backfill-reservation-subtotals/index.ts`**

1. **Line 143** — Expand the `fields` parameter:
   ```
   // From:
   fields: '_id money.subTotal',
   // To:
   fields: '_id money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue money.totalTaxes money.subTotal',
   ```

2. **After line 330** (after processing the first page) — Add a diagnostic log to confirm data shape:
   ```typescript
   if (firstPage.results.length > 0) {
     const sample = firstPage.results[0];
     console.log(`Sample reservation: _id=${sample._id}, money=${JSON.stringify(sample.money)}`);
   }
   ```

3. **Update the return type** on `fetchReservationPage` (line 135) to include the broader money fields so TypeScript doesn't complain, though only `subTotal` is used.

This is a one-line fix (the `fields` string) plus a diagnostic log. No other logic changes needed — the processing and skip logic are correct.

