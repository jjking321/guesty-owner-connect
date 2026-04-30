## Findings from investigation

### 1. Gross Booking Value — you are right to be suspicious
- `reservations.sub_total` (Guesty `money.subTotalPrice`) is currently set on only **11,253 of 42,239** reservations from 2025+ (~27%). The field was added later and most historical rows are NULL.
- `fare_accommodation_adjusted` is populated on **42,229 of 42,239** (~100%).
- Today the KPI sums `sub_total` only, so the GBV number is severely understated.
- `subTotalPrice` in Guesty = accommodation fare + cleaning + extras + guest service fees, **excluding taxes**. That matches your definition. We just need to backfill it and fall back gracefully.

### 2. Active & Listed Units — what it currently counts
The metric counts `listings` rows where:
- `is_listed = true` (Guesty `isListed`, i.e. listing is published on at least one channel)
- `active = true` (Guesty `active`, i.e. listing is enabled in Guesty)
- `archived = false` (not soft-deleted in our DB)

Current totals in DB: 485 active+listed, 275 with both flags off, 37 archived (826 total).

This needs to be visible in the UI so it's not a black box.

### 3. Last active date — Guesty does expose it
Guesty's listing object includes `lastActivityAt`, plus `activatedAt`, `deactivatedAt`, `listedAt`. We are not currently fetching any of them — the listing sync field list is `_id createdAt nickname status isListed active propertyType accommodates bedrooms address picture pictures integrations`. That's why `listings.last_active_at` is 0/826 populated and churn events fall back to "now".

### 4. Drill-down
No way today to see which listings are inside a KPI count. We'll add a click-to-list modal.

---

## Plan

### A. Backend: pull `lastActivityAt` from Guesty
1. Add `lastActivityAt deactivatedAt activatedAt` to the listing `fields` string in:
   - `sync-guesty-data/index.ts`
   - any other listing-fetching function that writes `is_listed`/`active`
2. Map `lastActivityAt` → `listings.last_active_at` on every upsert. Prefer `lastActivityAt`, fall back to `deactivatedAt` then current time.
3. One-time backfill: small edge function `backfill-listing-last-active` that pages all listings with the new field set and updates `last_active_at`.
4. Update `snapshot-listing-status`: when opening a churn event, use the listing's `last_active_at` (now reliable) instead of `now()`.

### B. Fix GBV calculation
1. Change `fetchGbv` in `src/lib/kpis/dataFetcher.ts` to use `COALESCE(sub_total, fare_accommodation_adjusted)` per reservation. This gives correct GBV where `sub_total` exists and a safe lower-bound elsewhere, instead of dropping the row entirely.
2. Add a small "Data quality" footnote on the GBV card showing the share of reservations in the period that have true `sub_total` vs are falling back to fare. So you can see when the number is fully accurate.
3. Trigger / surface the existing `backfill-reservation-subtotals` function from the KPI page header (admin-only button) so you can fill the gap.

### C. Clarify "Active & Listed" in the UI
1. Add an info tooltip on the card title explaining the exact criteria: `is_listed = true AND active = true AND archived = false` (using Guesty's `isListed` and `active` flags).
2. Subtitle on the card: "Currently listed on a channel and enabled in Guesty."

### D. Drill-down: click a KPI to see the units
1. Make each KPI card clickable. Opens a side sheet listing the underlying records for the **selected bucket** (or the latest bucket if you click the headline number).
2. Per-card content:
   - **Active & Listed units** → list of listings counted at that point in time (id, nickname, property type, bedrooms, last_active_at, status flags). Search + CSV export.
   - **GBV** → reservations contributing to the bucket (confirmation code, listing nickname, check-in, nights, sub_total used, source). Footer shows totals and how many used fallback.
   - **Churned units** → list of churn events in the bucket (listing nickname, churned_at from Guesty, reason, category, notes). Inline edit reason/category like the existing manage drawer.
   - **Guest review score** → list of reviews in the bucket (date, listing, OTA, rating, snippet). Sortable.
3. Implementation: extend each `fetchXxx` in `src/lib/kpis/dataFetcher.ts` with a sibling `fetchXxxDetail(bucketStart, bucketEnd)` returning the row list. New component `src/components/kpis/KpiDetailSheet.tsx`.

### E. Memory updates
- Note that `subTotalPrice` is the canonical GBV source with `fare_accommodation_adjusted` as fallback during backfill.
- Note that `lastActivityAt` is the Guesty source for `listings.last_active_at` and underpins churn `churned_at`.

---

## Files to change
- `supabase/functions/sync-guesty-data/index.ts` (listing fields + mapping)
- `supabase/functions/snapshot-listing-status/index.ts` (use last_active_at)
- new `supabase/functions/backfill-listing-last-active/index.ts`
- `src/lib/kpis/dataFetcher.ts` (GBV coalesce, detail fetchers, data-quality stat)
- `src/components/kpis/KpiCard.tsx` (clickable, tooltip, footnote)
- new `src/components/kpis/KpiDetailSheet.tsx`
- `src/pages/Kpis.tsx` (wire up detail sheet, optional admin backfill buttons)

## Out of scope (ask if you want them now)
- Categorizing churn reasons with a fixed picklist (currently free text + category text).
- Backfilling historical `last_active_at` from reservation activity for listings Guesty doesn't return a date for.