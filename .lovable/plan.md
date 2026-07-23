## Add per-property compset CSV export

Add an **Export CSV** button next to the existing "Save as Template" / "Fetch Future Rates" buttons in `src/components/ComparablesModule.tsx` on the Property Detail page.

### CSV contents (one row per comparable in that property's compset)

Columns:
- Selected (Yes/No)
- Listing name, host name, city, distance (mi)
- Bedrooms, bathrooms, accommodates, superhost, rating, review count
- TTM Revenue, TTM ADR, TTM Occupancy, TTM RevPAR
- Future rates monthly averages flattened as: `Future_ADR_YYYY-MM`, `Future_Occ_YYYY-MM`, `Future_RevPAR_YYYY-MM` for each month present in `future_rates` (aggregated per comparable using the same monthly aggregation the edge function uses)

### Implementation

- Reuse the aggregation logic already in `supabase/functions/fetch-comparable-future-rates/index.ts` (`aggregateFutureRatesToMonthly`) by porting a small client-side helper into `src/lib/reports/format.ts` neighbors — actually place it inline in `ComparablesModule.tsx` since it's local to this export.
- Reuse existing `downloadCsv` from `src/lib/reports/format.ts` for the file write.
- Filename: `compset-<listing-nickname>-<YYYY-MM-DD>.csv`.
- Button placed in the same button row as "Save as Template", disabled when the comparables list is empty.
- No backend changes — data is already loaded in the component.

### Out of scope

- Portfolio-wide export from the Comparables page (user chose per-property only).
- Non-selected comps are still included; a checkbox filter is not added unless requested.