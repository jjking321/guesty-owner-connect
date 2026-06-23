Here are the open security findings, grouped by severity, with a proposed fix plan. Approve and I'll implement.

## Critical (errors)

### 1. Open RLS policies leaking cross-org data
Three tables currently allow any authenticated (or even anonymous) user to read/write all rows.

- `dispute_analysis_progress` — `USING (true)` SELECT exposes guest names and errors across orgs.
- `forecast_settings` — `USING/WITH CHECK (true)` for SELECT/INSERT/UPDATE; `organization_id` column exists but unused.
- `nightly_sync_runs` — `USING (true)` exposes internal sync state, account IDs, errors.

**Fix (migration):** drop permissive policies, replace with org-scoped policies using `is_organization_member(organization_id, auth.uid())`. For `dispute_analysis_progress`, scope via its `guesty_account_id` join. For `nightly_sync_runs`, restrict reads to admins/super_admins of the org and writes to service role only.

### 2. Sensitive backend edge functions reachable without auth
9 functions use the service role internally with zero caller identity check:
`nightly-sync`, `batch-analyze-disputes`, `analyze-review-dispute`, `generate-actionables`, `generate-revenue-actions`, `generate-call-prep`, `sync-owners`, `fetch-dispute-conversation`, `apply-compset-template`.

**Fix:** At the top of each handler, validate `Authorization: Bearer <jwt>` via `supabase.auth.getClaims(token)`; 401 on failure. For scheduler-only functions (`nightly-sync`, `batch-analyze-disputes`, `generate-actionables`), additionally require `admin`/`super_admin` org role. For per-resource functions (`generate-revenue-actions`, `generate-call-prep`, `fetch-dispute-conversation`, `analyze-review-dispute`, `apply-compset-template`, `sync-owners`), additionally verify the caller's active org owns the targeted listing/review/account.

## High (warnings)

### 3. Client-controlled `x-service-role: true` header bypass
7 functions skip auth when this header is present: `calculate-all-probabilities`, `generate-all-forecasts`, `bulk-scrape-airbnb-ratings`, `sync-bulk-calendar`, `sync-new-reviews`, `backfill-reservation-subtotals`, `backfill-reservation-taxes`. Two of them (`calculate-all-probabilities`, `generate-all-forecasts`) also fall through without any auth, running across all orgs with `userId = undefined`.

**Fix:** Replace the boolean header check with a server-validated bearer check against `SUPABASE_SERVICE_ROLE_KEY` (compare `Authorization` header to the env secret). If neither service-role nor a valid user JWT is present → 401. Update internal `.invoke()` callers (e.g. `nightly-sync` orchestrator) to pass the service-role bearer instead of the boolean header. Memory note: this changes the documented "`x-service-role: true`" pattern — I'll update the memory entry accordingly.

### 4. Tables with overly-narrow `user_id = auth.uid()` RLS (org members locked out)
- `booking_curves`, `capacity_calendar`, `forecast_accuracy` — only the Guesty account creator can read; no INSERT/UPDATE/DELETE policies.

**Fix:** Add org-scoped SELECT (and write where relevant) policies via `is_organization_member` joined through `guesty_accounts.organization_id`.

### 5. Leaked password protection disabled
**Fix:** Enable HIBP check via `configure_auth { password_hibp_enabled: true }`.

### 6. SECURITY DEFINER functions executable by anon/authenticated
Supabase linter flags definer functions exposed on the API schema.

**Fix:** Run linter, then `REVOKE EXECUTE ... FROM anon, authenticated` on functions that should only be called server-side (e.g. internal helpers like `sync_super_admin_to_all_orgs`, `seed_super_admins_to_new_org`, `handle_*` triggers if exposed). Keep grants on functions intentionally callable by the client (e.g. `accept_organization_invitation`, `get_accessible_organizations`, `get_review_summary_stats`, `get_monthly_rating_trend`, `get_portfolio_night_metrics`).

### 7. RLS policy `USING (true)` for write ops
Re-audited as part of #1; no other tables flagged after that fix.

## Execution order
1. Migration: fix RLS on the 6 tables (#1, #4) + REVOKE on definer functions (#6).
2. Edge functions: add JWT/role checks (#2) and replace header bypass (#3) — single pass across all listed functions, then deploy.
3. `configure_auth` for HIBP (#5).
4. Update memory entry about the old `x-service-role` invocation pattern.
5. Re-run security scan; mark fixed findings.

## Out of scope
- Refactoring beyond auth/RLS (no business-logic changes).
- Rate limiting (not flagged).
- Connector or storage findings (none reported).