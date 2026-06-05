## Goal

Right now the KPI dashboard fires ~20 independent queries that each paginate the same big tables. We're going to share fetches so each table is pulled once per range, dramatically cutting load time.

## What's slow today

Each KPI card runs its own data fetcher in parallel. Several of them pull the **same data**:

- `reservations` (in the selected range) is paginated separately by: GBV, Channel mix, ADR, Cancellation rate, Revenue per listing → ~5× the work, doubled when comparing to last year (10× total).
- `listings` (full table) is paginated separately by: Listing growth, Churn, Net growth, Owner concentration, Revenue per listing → ~5× the work.
- `listing_churn_events` is fetched twice (Churn + Net growth).

With ~73k reservations and a YTD + compare range, that's the main bottleneck.

## Plan — shared in-memory cache

1. **Add a shared loader module** `src/lib/kpis/sharedData.ts` with:
   - `getReservationsForRange(start, end)` — paginates `reservations` once, caches the array keyed by the ISO range, returns the same promise to all concurrent callers.
   - `getAllListings()` — same pattern for the full listings table.
   - `getChurnEvents()` — same pattern for open + ignored churn events.
   - Cache lives in module scope and is cleared when the user changes the date range / aggregation / compare (we'll expose a `clearKpiCache()` and call it from `Kpis.tsx` when those controls change).

2. **Refactor the affected fetchers** in `src/lib/kpis/dataFetcher.ts` to read from the shared loaders instead of paginating themselves:
   - `computeGbvSeries`, `computeChannelMixSeries`, `computeAdrSeries`, `computeCancellationSeries`, `computeRevenuePerListingSeries` → use `getReservationsForRange`.
   - `fetchListingGrowth`, `computeChurnSeries`, `computeNetGrowthSeries`, `computeOwnerConcentrationSeries`, revenue-per-listing's listings call → use `getAllListings`.
   - `computeChurnSeries` and `computeNetGrowthSeries` → use `getChurnEvents`.
   - Drill-down detail fetchers (`fetchGbvDetail`, etc.) keep their own narrower fetches — those are user-triggered, not blocking the dashboard.

3. **Result:** for a YTD + compare-last-year load, reservations get paginated **twice** instead of ten times, listings get paginated **once** instead of five times. Expected ~3–5× faster initial render.

4. **No DB changes, no schema migrations.** Pure frontend refactor.

## Backfill fallback (deferred)

Holding on this until you check the 5 sample reservations above in Guesty. Two outcomes:

- **Guesty has subTotal but our backfill missed it** → bug in the fast-path fetch; I'll fix the function.
- **Guesty truly has no subTotal** → I'll add a small "checked, no subtotal" mark so re-runs don't keep flagging them, and surface "N reservations permanently use fare fallback" in the GBV card tooltip.

## Files touched

- `src/lib/kpis/sharedData.ts` (new)
- `src/lib/kpis/dataFetcher.ts` (refactor ~10 fetcher functions to use shared loaders)
- `src/pages/Kpis.tsx` (call `clearKpiCache()` when range/aggregation/compare changes)
