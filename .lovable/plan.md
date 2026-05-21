## Problem

Churned units shows 0 because `listing_churn_events` is empty — the nightly `snapshot-listing-status` job that populates it has never produced rows for this org. Meanwhile, the `listings` table already has **114 listings** that are currently churned (`is_listed=false AND active=false AND !archived`) with a `last_active_at` timestamp we can use as the churn date.

## Fix

Stop relying solely on the events table. Derive churn directly from `listings` and use the events table only as an enrichment layer for category/reason/notes.

### 1. Backfill `listing_churn_events` from current listing state (migration)

One-time SQL: for every listing where `is_listed=false AND active=false AND archived=false AND last_active_at IS NOT NULL` that doesn't already have an open churn event, insert one with `churned_at = last_active_at`. This unblocks the existing drawer + drill-down UI immediately and gives the snapshot job a clean baseline going forward.

### 2. Change `computeChurnSeries` / `fetchChurnDetail` in `src/lib/kpis/dataFetcher.ts`

Switch the source of truth from `listing_churn_events` to a query against `listings`:

```
SELECT id, nickname, last_active_at, guesty_account_id
FROM listings
WHERE is_listed = false
  AND active   = false
  AND archived = false
  AND last_active_at BETWEEN <range.start> AND <range.end>
```

- Bucket each listing by `last_active_at` to build the time series.
- Drill-down returns one row per churned listing with nickname + churn date. Left-join `listing_churn_events` (most recent open event per listing_id) so any category/reason/notes the user has entered in the Manage drawer still appear.

### 3. Keep the snapshot/events pipeline as the system of record for edits

The Manage Churned Units drawer continues to read/write `listing_churn_events`. After step 1's backfill, every currently churned listing has a row, so edits work. The nightly snapshot function keeps opening/closing events for future transitions — no changes needed there.

### Why this works

- Headline number stops being 0 immediately: we have 114 listings the DB already knows are churned.
- Time-series bucketing uses `last_active_at`, which is what the snapshot job itself would have used.
- We don't lose the human-entered metadata (category/reason/notes) because we still join the events table.

### Out of scope

- No edge function changes. We can optionally trigger `snapshot-listing-status` manually later, but it isn't required for this fix.
- No UI changes to `ManageChurnDrawer` or `KpiDetailSheet`.
