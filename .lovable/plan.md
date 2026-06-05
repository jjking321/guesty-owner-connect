## Add "Revenue per Listing" KPI card

Add a 10th card to the KPI dashboard showing GBV divided by average active listings for the selected period.

### Changes

**`src/lib/kpis/types.ts`**
- Add `'revenue_per_listing'` to the `KpiId` union.

**`src/lib/kpis/dataFetcher.ts`**
- Add a `computeRevenuePerListingSeries` (or extend the GBV/active-listings flow) that, for each bucket in the selected period:
  - Reuses GBV per bucket (already computed for the GBV card).
  - Computes average active listings in that bucket (reuse the active-listings series logic).
  - Returns `gbv / avgActiveListings` per bucket, plus an aggregated value for the headline.
- Honor the existing "exclude owner reservations" and "active, non-archived listings" rules already enforced elsewhere.
- Support the existing compare-period logic so the card shows delta vs. prior period.

**`src/pages/Kpis.tsx`**
- Register the new card in the KPI grid (label: "Revenue per Listing", currency formatting, same period/compare controls as the other cards).
- Wire its detail sheet to show the underlying per-bucket table (GBV, avg active listings, revenue/listing) like the other cards.
- Include it in the PDF export.

**`src/components/kpis/KpiCard.tsx` / `KpiDetailSheet.tsx`**
- No structural changes expected; just consumes the new series. Only adjust if a new formatter is needed.

### Notes
- Formula: `GBV in period / average active listings in period` (bucketed monthly or per the current aggregation).
- Excludes owner reservations; only `is_listed = true` listings count toward the denominator — consistent with project memory.
