

# Lock down Guesty OAuth credentials

## Problem
The `guesty_accounts` table holds `client_id` and `client_secret` in plaintext columns, and its RLS `SELECT` policy grants read access to every organization member. Any logged-in member can read another tenant admin's secret. The frontend already avoids selecting these columns, but RLS still allows it.

## Solution
Move credentials into a separate `guesty_account_credentials` table that only the service role can read. Strip the columns from `guesty_accounts` so they can never be exposed via the user-facing API. Edge functions continue to work because they already use the service role key.

## Plan

### 1. Database migration
Create `public.guesty_account_credentials`:
- `guesty_account_id uuid PRIMARY KEY REFERENCES guesty_accounts(id) ON DELETE CASCADE`
- `client_id text NOT NULL`
- `client_secret text NOT NULL`
- `created_at`, `updated_at` timestamps

Then:
- Enable RLS, add **no** policies for `authenticated`/`anon` (service role bypasses RLS). Add an explicit `REVOKE ALL ... FROM anon, authenticated` for defense in depth.
- Backfill: `INSERT INTO guesty_account_credentials SELECT id, client_id, client_secret, now(), now() FROM guesty_accounts`.
- Drop `client_id` and `client_secret` columns from `guesty_accounts`.

### 2. New edge function: `save-guesty-credentials`
A small authenticated function that the Settings page calls when adding/editing a Guesty account. It:
- Validates the caller's JWT and confirms they are an `admin` or `super_admin` of the target organization.
- Inserts the row into `guesty_accounts` (without secrets) and upserts the credentials row into `guesty_account_credentials` using the service role client.

This avoids exposing the credentials table to the client SDK at all.

### 3. Update existing edge functions (10 files)
In each function below, replace the current `.from('guesty_accounts').select('client_id, client_secret, ...')` call with two calls: one to `guesty_accounts` for the non-secret fields it needs, and one to `guesty_account_credentials` for the secrets.
- `sync-reviews`, `sync-new-reviews`, `sync-owners`, `sync-listing-calendar`, `sync-bulk-calendar`, `sync-listing-reservations`, `sync-new-reservations`, `fetch-dispute-conversation`, `backfill-reservation-subtotals`, `backfill-reservation-taxes`

### 4. Update `src/pages/Settings.tsx`
- `handleAddAccount`: call `supabase.functions.invoke('save-guesty-credentials', { body: { account_name, client_id, client_secret } })` instead of inserting directly into `guesty_accounts`.
- `loadAccounts`: already safe — no change needed (it never selected secrets).
- If there's an "edit credentials" flow, route it through the same edge function.

### 5. Mark security finding fixed
After deploying, mark `guesty_accounts_client_secret_exposure` as fixed with an explanation of the new architecture.

## Out of scope (separate findings)
The security panel also flagged: `forecast_settings` open RLS, `dispute_analysis_progress` cross-tenant leak, unauthenticated edge functions, the `x-service-role` header bypass, leaked password protection, and the `xlsx` vulnerability. These are tracked separately — this plan only addresses the Guesty credential exposure. Let me know if you'd like a follow-up plan covering the rest.

## Technical details
- The credentials table is keyed by `guesty_account_id` (PK + FK with cascade delete) so deleting an account auto-cleans its secrets.
- No client-side `supabase.from('guesty_account_credentials')` calls will exist anywhere — all access is through edge functions using `SUPABASE_SERVICE_ROLE_KEY`.
- The new `save-guesty-credentials` function will validate JWT in code (per project's edge function rules) and check `has_organization_role(organization_id, user_id, 'admin')` or `super_admin` before writing.
- Migration order matters: create + backfill the new table **before** dropping the columns, all in one transactional migration file.

