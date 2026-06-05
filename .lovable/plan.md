# Expand KPI Dashboard with 5 New Metrics

Add five new metric cards to `/kpis`, following the existing `KpiCard` + `fetch*` + drill-down pattern in `src/lib/kpis/dataFetcher.ts` and `src/pages/Kpis.tsx`.

## New metrics

### 1. Net unit growth (line chart)
Net change per bucket = new active listings added − units churned in that bucket.
- New: count of `currently active & listed` listings whose `created_at_guesty` falls inside the bucket.
- Churned: reuse existing churn signal logic (`getChurnSignalDate`) within the bucket.
- Headline = sum across range. Series shows both lines or a single net line; will use a single net line with compare.

### 2. Owner concentration
Share of active units owned by the top owner (and Top-5 share in helpText/meta).
- Join active listings → `owners.owner_id` → count per owner.
- Headline = `top1_units / total_active` as a percentage (new `unit: 'percent'` added to `KpiResult`).
- Series = top-1 share over time using snapshots when available, else cumulative backfill (same fallback strategy as listing growth).
- Drill-down: list owners ranked by unit count with % share.

### 3. Channel mix
Bar chart of GBV by `source` (Airbnb, Vrbo, Booking.com, Direct, etc.) for the period.
- Headline = % of GBV from the top channel.
- Series buckets along time with stacked or grouped bars per channel — to keep the existing `KpiCard` chart shape simple, we'll display a **horizontal-style summary** by using bucketed bars where the primary value = the dominant channel's GBV, plus a `meta.breakdown` array `{ source, gbv, share }` rendered as a small legend under the chart.
- Excludes owner reservations and non-revenue statuses (matches GBV rules).
- Drill-down: per-channel totals with reservation counts.

### 4. ADR (Average Daily Rate)
`sum(subTotal or fare fallback) / sum(nights_count)` for reservations checking in within the bucket. Excludes owner stays and cancellations (same filter as GBV).
- `unit: 'currency'`.
- Compare-period supported.
- Drill-down: per-reservation ADR (value/nights), sorted desc.

### 5. Cancellation rate
`canceled / (confirmed + checked_in + checked_out + canceled)` based on `created_at_guesty` falling in the bucket (so we measure intent during the period, not check-in). Excludes owner.
- `unit: 'percent'`.
- Headline = overall rate for the range.
- Drill-down: list of canceled reservations in window with listing nickname, guest, dates.

## Implementation outline

**`src/lib/kpis/types.ts`**
- Extend `KpiResult['unit']` to include `'percent'`.
- `KpiMetric` union gains `'net_growth' | 'owner_concentration' | 'channel_mix' | 'adr' | 'cancellation'`.

**`src/lib/kpis/dataFetcher.ts`**
- New fetchers: `fetchNetGrowth`, `fetchOwnerConcentration`, `fetchChannelMix`, `fetchAdr`, `fetchCancellationRate`.
- New drill-down fetchers wired through `KpiDetailSheet` (extend its `metric` switch).
- Reuse `paginate`, `buildBuckets`, `findBucketIdx`. Net growth reuses `getChurnSignalDate` + listings fetched once.

**`src/components/kpis/KpiCard.tsx`**
- `formatValue` handles `'percent'` (`(v*100).toFixed(1) + '%'`).
- Y-axis formatter and tooltip already use `formatValue`.

**`src/components/kpis/KpiDetailSheet.tsx`**
- Add cases for the 5 new metrics calling their respective `fetch*Detail` functions.

**`src/pages/Kpis.tsx`**
- Add 5 new `KpiCard` blocks in the grid with appropriate icons (`Users`, `PieChart`, `Banknote`, `XCircle`, `TrendingUp`).
- Add helpText explaining methodology for each.

## Notes / open assumptions
- ADR denominator uses summed nights of reservations counted in GBV (consistent with GBV exclusions).
- Cancellation rate is bucketed by `created_at_guesty` (when the booking was made). If you prefer bucketing by `check_in`, say so and I'll switch it.
- Owner concentration "top-1 share" is the headline; the meta will also expose Top-5 share + HHI for completeness.

If anything (especially the cancellation date basis or the channel-mix visualization choice) should be different, tell me before I implement.
