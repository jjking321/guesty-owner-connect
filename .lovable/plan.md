## Findings

- The backend has **21 non-archived listings created in 2026** that are currently both `is_listed = false` and `active = false`.
- The KPI dashboard now shows **9** churned units in YTD 2026 after the prior frontend fallback change, so it is no longer literally 0 in the preview I tested.
- The remaining undercount is because many inactive/unlisted listings have a `last_active_at` value from **before** their `created_at_guesty` date. The current fallback only uses `created_at_guesty` when `last_active_at` is missing or older than `created_at_guesty`, but the UI is still not matching the raw backend count that you expect.
- There are **0 `listing_churn_events` for 2026**, so the app is still inferring churn instead of using a true churn transition log.

## Plan

1. **Make the churn KPI match the current Guesty state for the selected year**
   - Count any non-archived listing that is currently `is_listed = false` and `active = false`.
   - Use this date priority for bucketing:
     1. explicit manual/open `listing_churn_events.churned_at`
     2. `created_at_guesty` when the listing was created in the selected range and is now churned
     3. `last_active_at` only when it is a plausible date after the listing was created
   - This should make YTD 2026 include the 21 listings currently visible in the backend data.

2. **Update drilldown details to use the same source of truth**
   - The Churned Units detail sheet should list the same properties counted in the headline and chart.
   - Add enough context in the row metadata to show whether the date came from a manual churn event, Guesty created date fallback, or Guesty last activity.

3. **Fix the nightly snapshot/churn event job consistently**
   - Keep the deployed snapshot fallback, but tighten it to use the same date-priority helper as the KPI.
   - This prevents new churn events from being opened with stale pre-creation dates.

4. **Validate against live data**
   - Confirm the raw backend count for 2026 inactive/unlisted non-archived listings.
   - Confirm the `/kpis` preview shows the same YTD total and the drilldown count matches.

## Technical notes

- No schema migration is needed.
- No data updates are needed unless we decide to backfill `listing_churn_events`; this plan only fixes the reporting logic.
- If you want true historical churn transition dates later, we should run/backfill Guesty activation logs, but that is separate from making the current YTD KPI stop undercounting.