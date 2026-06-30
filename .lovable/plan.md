
# Add TrackHS as a Second PMS Source

Build a full parallel integration to TrackHS (TNS) that mirrors the existing Guesty pipeline. Track data lives in its own tables, then unified database views merge Guesty + Track so the rest of the app keeps reading one logical dataset.

## 1. Credentials & accounts (DB)

New tables in `public`:
- `track_accounts` — one per connected TrackHS tenant: `organization_id`, `account_name`, `api_base_url` (e.g. `https://{customer}.trackhs.com/api`), `is_active`, sync timestamps. Mirrors `guesty_accounts`.
- `track_account_credentials` — `track_account_id`, `username` (API user), `password` (API key/secret). Service-role only; never exposed to clients.

RLS: org members can read `track_accounts`; only admins/super-admins can write. Credentials table has no client policies (edge functions only via service role).

## 2. Track-specific data tables

Parallel to existing Guesty tables. Each row carries `track_account_id` and the native Track ID.

- `track_listings` — id (Track unit id), `track_account_id`, name, address, bedrooms, bathrooms, max occupancy, is_active, raw payload, last_synced_at.
- `track_reservations` — id, `track_account_id`, `track_listing_id`, guest name, check_in, check_out, nights, status, source/channel, subtotal, taxes, fees, total, raw payload.
- `track_reservation_nights` — exploded per-night revenue allocation (mirrors `reservation_nights`).
- `track_capacity_calendar` — `track_listing_id`, date, is_blocked, nightly_rate, min_stay, source.
- `track_reviews` — id, `track_listing_id`, reservation_id, rating, category ratings, public/private text, source, review_date.

All tables: RLS scoped via `track_accounts.organization_id` + `is_organization_member`; GRANTs to `authenticated` (SELECT) and `service_role` (ALL).

## 3. Unified views (the "merge" layer)

Read-only views the app queries instead of raw provider tables:

- `v_unified_listings` — UNION ALL of `listings` (provider='guesty') and `track_listings` (provider='track'), with a stable composite key `provider || ':' || id` and normalized columns (name, bedrooms, address, organization_id resolved through accounts).
- `v_unified_reservations` — same pattern; includes `provider`, `listing_uid`, financials normalized to subtotal/tax/total.
- `v_unified_reservation_nights` — UNION of both nights tables, used by revenue/forecast paths.
- `v_unified_calendar` — UNION of capacity calendars.
- `v_unified_reviews` — UNION of reviews.

Views run as `security_invoker` so RLS on the underlying tables governs access. App-side reads switch incrementally to these views; existing Guesty-only queries keep working until migrated.

## 4. Edge functions (Track sync pipeline)

Mirror the Guesty function set, each with Basic Auth (`Authorization: Basic base64(username:password)`), 5-attempt exponential backoff on 429, and the same batching/timeout patterns:

- `sync-track-listings` — paginate units, upsert into `track_listings`.
- `sync-track-reservations` — incremental by `updated_at`, upsert reservations + trigger nights explosion.
- `sync-track-calendar` — 365-day forward blocks + rates into `track_capacity_calendar`.
- `sync-track-reviews` — pull reviews, normalize ratings into `track_reviews`.
- `explode-track-reservation-nights` — trigger-driven, fans reservations out into `track_reservation_nights`.
- `nightly-sync-track` — orchestrator wrapping the above (parallel to existing `nightly-sync`).
- `save-track-credentials` — validates Basic Auth against a lightweight Track endpoint, then upserts into `track_account_credentials`.

All functions: JWT-verified for user-initiated, role-gated (admin/super_admin) for sync triggers, with the standard `Authorization: Bearer SERVICE_ROLE_KEY` pattern for internal `.invoke()` calls.

## 5. Frontend

- **Settings → Integrations**: add a "TrackHS" card next to Guesty with Connect/Disconnect, fields for base URL + username + password, "Test connection" button, last-sync indicator.
- **Sync controls**: replicate the per-account Sync buttons currently used for Guesty (listings/reservations/calendar/reviews + nightly).
- **Source filter**: a global "Source" filter (All / Guesty / Track) on portfolio, reservations, reviews, calendar, KPIs — defaults to All so unified views drive everything.
- **Platform icon**: add a `TrackIcon` and wire it into `PlatformIcon` for badges.

## 6. Migration of read paths

Switch high-traffic reads from `reservations` / `listings` / `reviews` / `reservation_nights` to the `v_unified_*` views: Portfolio, Reservations page, Reviews, KPIs, Forecast inputs, Tax report, Actionables. Writes stay on provider-specific tables; only sync functions write.

## Technical details

- TrackHS auth: HTTP Basic over HTTPS. Customer-specific base URL captured per account.
- Pagination: TrackHS uses `page`/`size`; loop until empty page with 500ms inter-page delay.
- Incremental sync: filter on `updatedSince` for reservations and reviews; full refresh for listings nightly.
- Nights explosion + revenue allocation reuse the existing per-night model (night-based distribution; exclude owner reservations if Track marks them via reservation type).
- Indexes: `(track_account_id, updated_at desc)` on reservations and reviews; `(track_listing_id, night_date)` on nights; `(track_listing_id, date)` on calendar.
- Secrets needed: none global — credentials are per-account in `track_account_credentials`.
- Cron: add a Track row to the nightly-sync schedule that calls `nightly-sync-track`.

## Out of scope (this phase)

- Writing back to TrackHS (rate pushes, block creation).
- Cross-provider deduplication (a property in both Guesty and Track shows up twice; can address later via a `linked_listing_id` mapping).
- TrackHS messaging/inbox.

## Open question to confirm before build

What's the TrackHS API base URL pattern your tenant uses (e.g. `https://{slug}.trackhs.com/api` vs `https://api.trackhs.com/pms/...`)? I'll wire the credentials form and base-URL handling around whichever shape you have. If you have a docs link, drop it and I'll match field names exactly.
