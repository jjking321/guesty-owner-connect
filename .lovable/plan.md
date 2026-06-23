## Section-scoped date filter for "Properties in Group"

Add a compact preset selector in the `Properties in Group` card header (`src/pages/GroupDetail.tsx`) that overrides the date range used to compute the table's metrics — Actual Revenue, On the Books, Occupancy, ADR, RevPAR — without affecting the rest of the page.

### UI
- Right side of the card header, next to the **Edit** button.
- A small shadcn `Select` (or segmented dropdown) labeled by the active preset.
- Presets:
  - **MTD** — month to date
  - **QTD** — quarter to date
  - **YTD** — year to date (default; matches page picker)
  - **Last 30 days**
  - **Last 90 days**
  - **Custom…** — opens a popover with the existing `StripeDateRangePicker`
- When the active preset differs from the page-level range, show a subtle "in range" hint under the card title (e.g. `Showing Jun 1 – Jun 23, 2026`).

### Behavior
- New local state `propertiesRange` (defaults to `null` → falls back to page-level `effectiveDateRange`, preserving today's behavior).
- A new memo `propertiesEffectiveRange` resolves either the preset/custom range or the page-level range.
- Replace `effectiveDateRange` references inside the `PropertiesTable` mapping block (lines ~1440-1510) with `propertiesEffectiveRange` for:
  - `reservationNights` filtering window
  - `futureReservationNights` window
  - `daysInRange` divisor for occupancy/RevPAR
  - `getDistributedRevenue` (if it accepts a range; otherwise re-derive a per-listing revenue sum from `reservationNights` filtered to the new window so the table stays consistent)
- Goals/forecasts continue to use the page-level year — they're annual figures, not date-range metrics.

### Data
- No new queries needed if the existing `reservationNights` / `futureReservationNights` queries cover a wide enough window. They currently fetch the page-level range, so I'll widen them to cover the **maximum of page range and section range** (or fetch a fixed YTD + next 365 days window) so any preset works without refetching.
- If widening would noticeably increase payload, fall back to a separate query keyed on `propertiesEffectiveRange`.

### Out of scope
- No change to the page-level picker, the goals card, the forecast card, or sub-groups.
- No change to sort/column behavior in `PropertiesTable`.

### Technical notes
- Preset → range computed with `date-fns` (`startOfMonth`, `startOfQuarter`, `startOfYear`, `subDays`).
- Custom range reuses `StripeDateRangePicker` inside a `Popover` so styling matches the rest of the app.