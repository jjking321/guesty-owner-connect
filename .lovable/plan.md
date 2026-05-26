## Goal

Use the uploaded Guesty deactivation report as the **source of truth** for churn dates, replacing the fuzzy `last_active_at` / `created_at_guesty` fallbacks currently feeding the Churned Units KPI.

## What I'll do

1. **Parse the CSV** (~154 records, 3 lines each: `listingId`, `deactivatedDate`, `deactivatedBy`) into clean `{listing_id, churned_at, deactivated_by}` rows.

2. **Match to our DB** — join on `listings.id` (Guesty ObjectId). Report any IDs in the CSV that don't exist in our listings table so we can spot mismatches (likely archived or in a different org).

3. **Upsert `listing_churn_events`** for the Beachside VR org:
   - For each matched listing currently churned (`is_listed=false AND active=false`): create or update a churn event with `churned_at = deactivatedDate` from the CSV.
   - Store `deactivatedBy` in the `notes` column (e.g. `"Deactivated by Brooke VanDerLinden (imported from Guesty report)"`).
   - If a churn event already exists for that listing with a different date, **overwrite** `churned_at` with the CSV value (CSV wins).
   - Skip listings that are currently active/listed (they were reactivated — leave existing closed events alone).

4. **Update the KPI date-priority logic** so manual `listing_churn_events.churned_at` is always preferred over Guesty fallbacks (this is already the intent, but I'll verify both `dataFetcher.ts` and `snapshot-listing-status/index.ts` use the same priority and the imported events flow through to the YTD count).

5. **Validate**: re-check the YTD 2026 Churned Units count on `/kpis` and confirm the drilldown lists the same properties with the imported dates.

## Technical notes

- One-off import via the insert tool — no migration needed.
- Will run a dry-run SELECT first to show: total parsed, matched to DB, unmatched (with their IDs), and how many will be inserted vs updated. You approve before I write.
- Won't touch listings that the CSV doesn't mention.

## Open question

The CSV spans **Jul 2025 → May 2026** and includes ~154 listings. Should I import **all of them**, or only the ones that are currently still churned in our DB (skip ones that were since reactivated)?
