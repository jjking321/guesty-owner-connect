## Goal

Clear the 5,591 missing-subtotal reservations on Beachside VR, and make sure the UI can do this on its own in the future (the current 24-month window doesn't cover your 2023 history or 2027 OTB bookings).

## Root cause

We confirmed via a one-off API call that Guesty *does* return `money.subTotalPrice` for the missing reservations (e.g. `GY-ptkMWmhL` came back as `$6,582.89`, matching the folio screenshot exactly). The previous backfill simply never visited some months — the UI only offered the last 24 months, but your gaps run from **Oct 2023 → Feb 2027**.

## Changes

### 1. `src/components/BackfillSubtotals.tsx` — widen month picker

Change the month-options generator from "last 24 months" to **48 months back + 18 months forward** (66 total). This covers all historic data and future on-the-books reservations.

```text
i = 0   → +18 months (future)
...
i = 17  → current month
...
i = 65  → -47 months
```

The existing `missingByMonth` query already paginates from `earliest`, so it will automatically include the new months. The existing "Select months with missing data" button will then select **every** month with gaps in one click.

### 2. Kick off the Beachside VR backfill now

Once you approve and switch to build mode, I'll invoke `backfill-reservation-subtotals` once per gap month for the Beachside VR account (`a864693d-...`) with `onlyMissing: true`. Each call self-chains via the edge function's built-in continuation pattern, so it runs unattended.

Gap months to process (39 total): `2023-10` through `2027-02` (skipping `2026-06` which has zero gaps).

Expected result: ~5,591 reservations updated, a handful skipped (truly deleted in Guesty).

### 3. No backend changes

The edge function itself is correct as-is. No migrations, no schema changes.

## Out of scope

- Renjoy account (different org — those 2027 placeholder bookings appear to be deleted/cancelled in Guesty; can be handled separately).
- Removing the "fallback to fare" warning text — once the backfill finishes, the Data quality line on the GBV card will naturally drop toward ~100% coverage.
