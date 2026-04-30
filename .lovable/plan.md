# KPI Dashboard

A new top-level **KPIs** page that tracks four key business metrics over time, with user-selectable period and comparison period — modeled on the screenshot's date-aggregation + range UX.

## What you get

- **New `/kpis` route** in the sidebar (visible to super_admin / admin / member).
- **Global controls** at the top of the page:
  - Date aggregation: Daily, Weekly, Monthly, Quarterly, Yearly
  - Date range: presets (This month, YTD, TTM, Last 30/90/365 days, Last year, Custom) + custom from/to picker
  - Compare to: None, Previous period, Last year, 2 years ago, Last 30 days, Last 90 days, Last month
- **Four KPI cards + trend charts**, each showing:
  - Big-number total for the period
  - Comparison total + % delta vs compare period
  - Line/bar chart bucketed by the chosen aggregation, with the compare series overlaid

## The four KPIs

### 1. Listing growth (active & listed units)
- **Source**: hybrid (per your answer).
- **Backfill**: cumulative count of listings where `created_at_guesty <= bucket end` AND currently `is_listed = true AND active = true AND archived = false`. Gives a clean historical curve immediately.
- **Going forward**: a new `listing_status_snapshots` table records a daily count per organization (active/listed/archived/churned). A nightly cron job writes one row per org per day. Once snapshots exist, the chart prefers snapshot data over the backfill calculation for any date with a snapshot — so dates after launch correctly reflect past de-listings/churn.

### 2. Gross Booking Value (GBV)
- Sum of `reservations.sub_total` (Guesty `money.subTotalPrice`, all fees included, taxes excluded — matches your project rule).
- Excludes `source = 'owner'` and cancelled reservations.
- Bucketed by **check-in date** (so revenue lands in the period the stay starts — ask if you'd prefer night-distributed instead).
- Compare period uses the same logic over the shifted range.

### 3. Churned units
- **Definition** (per your answer): a listing is churned the first time it is observed with `is_listed = false AND active = false`. Until that flips, it isn't churned. If it later flips back to listed/active, the churn record is cleared.
- **New table** `listing_churn_events`: `listing_id`, `organization_id`, `churned_at` (last_active_date from Guesty when available, else first detected date), `restored_at` (nullable), `reason` (nullable, free-form for now), `category` (nullable, enum-as-text — populated later when categories are defined), `notes`, `updated_by`.
- **Detection**: nightly job scans listings, opens a churn event when a listing flips into the churned state and there is no open event, closes an event when a listing flips back. Backfills one initial pass at deployment.
- **last_active_date from Guesty**: the existing listing sync is extended to also pull/store Guesty's `lastActivityAt` (or equivalent field) when present, used as the authoritative `churned_at` timestamp.
- **UI**: KPI card shows count of churn events whose `churned_at` falls in the period. A "Manage churned units" drawer opens a paginated table where users can edit the reason, add a category, and add notes per event.

### 4. Guest review score
- Uses existing `reviews` table (already excludes removed reviews) + the existing `get_monthly_rating_trend` RPC for the chart.
- **Per-module toggle** (your answer): "Reviews dated within period" (mean of period reviews) vs "Lifetime-to-date as of period end" (rolling cumulative average).
- KPI card shows the chosen aggregation's average + comparison delta.

## Sidebar entry

Inserted under Reports, gated on `super_admin / admin / member` (owners excluded), matching the existing pattern.

## Page layout

```text
+----------------------------------------------------------+
|  KPIs                                                    |
|  [Aggregation: Monthly v]  [Range: YTD v ...]            |
|  [Compare: Last year v]                                  |
+----------------------------------------------------------+
|  [Listings]    [GBV]    [Churned]    [Review score]      |
|   1,248         $4.2M     17           4.78               |
|   +12 vs LY     +18% LY   -3 vs LY     +0.04 LY           |
+----------------------------------------------------------+
|  Listings over time              GBV over time           |
|  [line chart w/ compare]         [bar chart w/ compare]  |
|                                                          |
|  Churned units over time         Review score over time  |
|  [bar chart]                     [line chart]            |
+----------------------------------------------------------+
|  [Manage churned units] (drawer w/ table + edit reason)  |
+----------------------------------------------------------+
```

## Technical details

### New tables (migration)
- `listing_status_snapshots(organization_id uuid, snapshot_date date, total_listed int, total_active int, total_archived int, total_churned int, primary key (organization_id, snapshot_date))` — RLS: org members can SELECT; service role inserts.
- `listing_churn_events(id uuid pk, organization_id uuid, listing_id text, churned_at timestamptz, restored_at timestamptz null, reason text null, category text null, notes text null, updated_by uuid null, created_at, updated_at)` — RLS: org members SELECT; admins/super_admins UPDATE/INSERT/DELETE; one open event per listing enforced via partial unique index where `restored_at is null`.
- Extend `listings` with `last_active_at timestamptz null` (populated from Guesty sync when available).

### New edge function
- `snapshot-listing-status` — runs nightly via `pg_cron` + `pg_net`. For each org: writes today's snapshot row, opens new churn events for newly-churned listings, closes events for restored listings. Idempotent on `(organization_id, snapshot_date)`.

### Frontend
- New page `src/pages/Kpis.tsx`.
- New components in `src/components/kpis/`: `KpiControls.tsx`, `KpiCard.tsx`, `ListingsChart.tsx`, `GbvChart.tsx`, `ChurnChart.tsx`, `ReviewScoreChart.tsx`, `ManageChurnDrawer.tsx`.
- Shared bucketing helper in `src/lib/kpis/bucket.ts` that aggregates daily/weekly/monthly/quarterly/yearly using `date-fns`.
- Sidebar entry added in `src/components/AppSidebar.tsx`; route registered in `src/App.tsx`.

### Data fetching pattern
- All listing/reservation/review queries respect RLS and use the existing batched-fetch pattern (chunks of 60 IDs, 1000-row pagination) to bypass the 1k row limit, consistent with `src/lib/reports/dataFetcher.ts`.

### Out of scope for MVP
- Filtering KPIs by group / owner / specific listings (can add later — same scope picker as Reports).
- Embedding these KPIs as modules inside the Reports builder (separate effort).
- A formal `churn_category` enum — left as free text + nullable category field so categories can be added later without a schema change.
