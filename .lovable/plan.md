

# Custom Reports Builder

A new **Reports** tab where any internal user can compose, save, and export custom reports. Every saved report and template is shared with the whole organization.

## What you get

- **New `/reports` route** in the sidebar (visible to super_admin, admin, member — not owners).
- **Three pages:**
  - **Reports list** — all saved reports + templates in the org, with "New Report" button.
  - **Report builder** — drag-free, form-driven canvas where you add modules (widgets) and configure each one.
  - **Report viewer** — the rendered report, with PDF export and per-module CSV export.

## Building a report

A report is a **title + description + ordered list of modules**. Each module is one widget. To add a module you pick:

1. **Widget type** — KPI card, table, line chart, or bar chart
2. **Data source** — Revenue, Nights Booked, Occupancy %, ADR, RevPAR, Goals (target), or Forecast (P50)
3. **Scope** — All listings, specific listings (multi-select), a Group, or an Owner
4. **Date range** — preset (This month / YTD / TTM / Last year / Custom) or explicit start/end
5. **Breakdown** (table & chart only) — by Month, by Listing, by Owner, or by Group
6. **Optional comparison** — vs Last Year, vs Goal, or none

The same `monthlyMetrics` / `reservation_nights` / `property_goals` data already powering Property Detail and Goals Review feeds the builder, so numbers match the rest of the app exactly.

## Templates vs saved reports

- **Saved Report** — a fully-configured report you can re-open and view anytime. Re-runs against live data each time.
- **Template** — same shape, but treated as a starting point: "New Report from Template" clones it so you can tweak before saving.
- Both live in one shared library; a checkbox `is_template` distinguishes them. Anyone in the org can create, edit, clone, or delete either.

## Export

- **Per module:** every rendered widget has a "CSV" button (same blob-download pattern already used in Pacing, Monthly Breakdown, and Performance Metrics).
- **Whole report → PDF:** "Export PDF" button at the top of the viewer. Client-side rendering via `html2canvas` + `jspdf` (each module captured as an image, paginated, with the report title and date range in the header).

## Out of scope (v1)

Reviews data, compset/comparables, booking probabilities, pacing/curves, custom formulas, pivot tables, and scheduled email delivery. These are intentionally deferred so v1 ships clean — easy to add as new "data sources" later because the builder is data-driven.

---

## Technical details

### Database
One new migration adds:

```sql
create table public.custom_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by uuid not null,
  name text not null,
  description text,
  is_template boolean not null default false,
  config jsonb not null,           -- { modules: [...], default_date_range: {...} }
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.custom_reports enable row level security;
-- SELECT/INSERT/UPDATE/DELETE: any organization member (matches "shared with org")
```

`config.modules[]` shape:
```ts
{
  id: string,
  type: 'kpi' | 'table' | 'line' | 'bar',
  title: string,
  metric: 'revenue' | 'nights' | 'occupancy' | 'adr' | 'revpar' | 'goal' | 'forecast_p50',
  scope: { kind: 'all' | 'listings' | 'group' | 'owner', ids?: string[] },
  dateRange: { preset: string } | { start: string, end: string },
  breakdown?: 'month' | 'listing' | 'owner' | 'group',
  compare?: 'last_year' | 'goal' | null,
}
```

### Frontend
- `src/pages/Reports.tsx` — list view (cards/table of saved reports + templates, "New" button).
- `src/pages/ReportBuilder.tsx` — `/reports/new` and `/reports/:id/edit`. Left panel = report metadata + module list with up/down/delete. Right panel = module config form. Live preview pane.
- `src/pages/ReportViewer.tsx` — `/reports/:id`. Renders modules read-only with CSV/PDF export.
- `src/components/reports/modules/{KpiCard,DataTable,LineChartModule,BarChartModule}.tsx` — one component per widget type, all accept the same `(config, data)` props.
- `src/lib/reports/dataFetcher.ts` — single function `fetchModuleData(module)` that maps a module config to the right Supabase query (`reservation_nights` for revenue/nights/occupancy/ADR/RevPAR aggregations, `property_goals` for goals, `forecast_aggregates` for forecast_p50). Re-uses existing batched-fetching pattern to bypass the 1000-row limit.
- `src/components/AppSidebar.tsx` — add `Reports` entry (icon: `FileBarChart`).
- `src/App.tsx` — add the three routes.

### Export
- Add `jspdf` and `html2canvas` deps. PDF = walk the rendered viewer DOM, snapshot each `[data-report-module]` element, place each on its own page (or stack short ones), prepend a cover with title + range + generated-at.
- CSV per module reuses the existing `Blob` + `URL.createObjectURL` helper pattern already in the codebase.

### Permissions
- Sidebar entry filtered to `super_admin / admin / member` (matches the answer).
- RLS policies use `is_organization_member(organization_id, auth.uid())` for all four verbs, so everyone in the org sees everything — no ownership checks.

