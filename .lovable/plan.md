
Goal
- Stop Guesty OAuth (`/oauth2/token`) from getting rate-limited by reducing how often we hit the token endpoint across the app, and by preventing “stampede” behavior (multiple syncs starting at once all requesting a token).

What I found (why OAuth is getting rate limited)
1) We call the Guesty OAuth token endpoint in at least 7 different backend functions:
   - sync-new-reservations
   - sync-listing-reservations
   - sync-listing-calendar
   - sync-bulk-calendar
   - sync-guesty-data
   - sync-reviews
   - sync-owners
2) These functions do not share tokens with each other.
   - Each function independently calls `/oauth2/token` at the start of its run.
   - If you click multiple sync buttons close together (very easy from Settings), you create a burst of OAuth calls.
3) Settings page currently makes it easy to create that burst:
   - There are separate buttons for Listings, Reservations, Owners, Reviews, Calendar.
   - A user can trigger multiple of these back-to-back (or multiple users can do it).
   - Even if each function retries responsibly, the initial simultaneous token requests can trip Guesty’s protective OAuth rate limits.
4) Some functions (ex: sync-bulk-calendar) already reuse the token across self-invocations, which is good.
   - But it still fetches a new token on the first batch, and other functions don’t reuse at all.
5) There’s also a security smell that matters for token caching:
   - `src/pages/Settings.tsx` does `.select("*")` from `guesty_accounts`.
   - RLS allows all organization members to SELECT guesty_accounts (per policy list), so secrets (client_secret) are currently exposed to org members if they can hit that query.
   - If we add cached access tokens into `guesty_accounts`, we would worsen this unless we fix the exposure.

Solution design
A) Add a shared server-side token cache (per Guesty account) that every Guesty sync function uses.
   - Store:
     - access_token
     - expires_at
     - oauth_cooldown_until (when Guesty says “don’t try again until…”)
     - refresh_in_progress + refresh_started_at (to prevent multiple functions refreshing at once)
   - Use a “single-flight” lock:
     - First caller acquires lock and fetches new token.
     - Other callers wait briefly and then reuse the cached token rather than requesting their own.
   - Always respect Retry-After and persist cooldown across all functions:
     - If any function hits OAuth 429, record oauth_cooldown_until so all other functions fail fast with a clear message instead of pounding OAuth again.

B) Put the cache in a dedicated table (recommended) rather than `guesty_accounts`.
   - This avoids exposing access tokens to org members via existing `guesty_accounts` SELECT policies.
   - Edge functions use the service role to access it; frontend never reads it.

C) UI guardrails (secondary, but helpful)
   - Disable or “serialize” sync button actions on Settings while a sync is starting.
   - Add the same 3-minute cooldown behavior to the Property “Sync Reservations” button that Reservations page already has for OAuth-rate-limit errors.
   - These reduce accidental bursts, but the real fix is server-side caching + locking.

Implementation plan (code + database)
1) Database change (backend)
   1.1 Create a new table: `guesty_oauth_tokens`
   - Columns:
     - guesty_account_id uuid PRIMARY KEY REFERENCES guesty_accounts(id) ON DELETE CASCADE
     - access_token text NOT NULL
     - expires_at timestamptz NOT NULL
     - oauth_cooldown_until timestamptz NULL
     - refresh_in_progress boolean NOT NULL DEFAULT false
     - refresh_started_at timestamptz NULL
     - updated_at timestamptz NOT NULL DEFAULT now()
   1.2 Enable RLS on `guesty_oauth_tokens` and do NOT add any SELECT policies for regular users.
   - Edge functions use service-role so they can still read/write.
   - This prevents UI / user queries from ever seeing tokens.

2) Create a shared “token manager” pattern and apply it to every Guesty function
   - We’ll implement the same logic inline in each function’s `index.ts` (since edge functions are isolated and we’re keeping it simple/consistent).
   - New helper in each function: `getGuestyAccessTokenCached(supabaseAdmin, accountId, clientId, clientSecret)`
     Behavior:
     - Step 1: Read token row from `guesty_oauth_tokens` by guesty_account_id.
       - If oauth_cooldown_until is in the future: throw `OAUTH_RATE_LIMIT:` with “Please wait X minutes”.
       - If token exists and expires_at is still valid (with safety buffer, e.g. expires_at > now + 2 minutes): return it (cache hit).
     - Step 2: Acquire refresh lock atomically:
       - Try update `refresh_in_progress=true, refresh_started_at=now()` only if refresh_in_progress=false OR refresh_started_at is stale (e.g. older than 90 seconds).
       - If we fail to acquire lock:
         - Wait/poll (e.g. 3–6 polls over up to ~6 seconds) for another invocation to refresh and write the token.
         - Then return the token if it appears; otherwise proceed to attempt lock again or fail gracefully.
     - Step 3: If lock acquired:
       - Call Guesty `/oauth2/token` using the required retry logic:
         - Exponential backoff: Math.min(2000 * 2^(attempt-1), 30000)
         - Honor Retry-After headers (seconds or date)
         - Cap wait time with MAX_WAIT_TIME_MS (55s)
       - On success:
         - Parse expires_in (if present) to set expires_at; otherwise use a conservative default (e.g. now + 55 minutes).
         - Upsert into `guesty_oauth_tokens`: access_token, expires_at, oauth_cooldown_until=null, refresh_in_progress=false, updated_at=now()
       - On OAuth 429:
         - Compute cooldown_until based on Retry-After (or default 3–5 minutes).
         - Update `guesty_oauth_tokens` with oauth_cooldown_until and clear refresh_in_progress.
         - Throw `OAUTH_RATE_LIMIT:` with a clean message.
       - Always clear refresh_in_progress in a finally block to avoid deadlocks.
     - Add clear logs:
       - “token_cache_hit”, “token_cache_miss_refreshing”, “token_refresh_lock_acquired”, “token_refresh_lock_wait”.

3) Update the following backend functions to use the shared cached-token logic (and remove direct token calls)
   - supabase/functions/sync-new-reservations/index.ts
   - supabase/functions/sync-listing-reservations/index.ts
   - supabase/functions/sync-listing-calendar/index.ts
   - supabase/functions/sync-bulk-calendar/index.ts (keep existing reuse across self-invocation; also use cache for first token)
   - supabase/functions/sync-guesty-data/index.ts
   - supabase/functions/sync-reviews/index.ts
   - supabase/functions/sync-owners/index.ts
   Notes:
   - Data API calls (non-OAuth) keep their existing 429 retry logic and rate-limit header logging.
   - OAuth fetch MUST follow the strict pattern and also persist cooldown.

4) Frontend safety fixes (reduce accidental bursts)
   4.1 Settings page: stop fetching secrets and reduce accidental concurrent sync starts
   - src/pages/Settings.tsx:
     - Replace `.select("*")` with an explicit list of safe fields (id, account_name, created_at, last_* sync fields, organization_id).
     - Disable other “Sync …” buttons while any one is in progress (simple UX throttling).
     - Optional: a single “Run Sync (Recommended)” button that runs sync operations sequentially (listings → reservations → owners → reviews → calendar) rather than user clicking many.
   4.2 Property detail: apply cooldown for “Sync Reservations”
   - src/pages/PropertyDetail.tsx:
     - If the function returns `OAUTH_RATE_LIMIT:...`, apply a 3-minute cooldown (mirroring Reservations page).
     - Persist per listing in localStorage (key includes listingId).
     - This prevents spam-clicking that repeatedly triggers OAuth.
   4.3 Listing calendar component (optional but consistent)
   - src/components/ListingCalendar.tsx:
     - If it hits `OAUTH_RATE_LIMIT`, apply cooldown similar to above.

5) Fix misleading OAuth error message formatting everywhere
   - sync-new-reservations currently uses the buggy “…Please wait ${estimatedWaitMinutes}-5 minutes…”.
   - Align it with the corrected version:
     - `Math.max(3, Math.ceil(retryAfterMs / 60000))`
     - Message: “Please wait X minutes before trying again.”

Validation / how we’ll confirm it’s fixed
- Functional tests:
  - Click multiple sync actions in Settings quickly:
    - Expected: only the first one refreshes; others should log cache hits or wait and then reuse.
    - OAuth endpoint should be called once per account within the token lifetime.
  - Trigger Property “Sync Reservations” repeatedly:
    - Expected: after an OAuth 429, UI enters cooldown, and backend returns fast without hammering OAuth (because oauth_cooldown_until blocks new refresh attempts).
- Log verification:
  - In each function logs, confirm:
    - cache hit/miss metrics
    - no repeated `/oauth2/token` calls in bursts
    - cooldown respected across different functions
- Regression check:
  - Ensure normal data fetch flows still work (reservations, calendar, reviews).

Files & components that will change
Backend (database + functions)
- New migration: create `guesty_oauth_tokens` table (+ RLS)
- Update edge functions:
  - supabase/functions/sync-new-reservations/index.ts
  - supabase/functions/sync-listing-reservations/index.ts
  - supabase/functions/sync-listing-calendar/index.ts
  - supabase/functions/sync-bulk-calendar/index.ts
  - supabase/functions/sync-guesty-data/index.ts
  - supabase/functions/sync-reviews/index.ts
  - supabase/functions/sync-owners/index.ts

Frontend
- src/pages/Settings.tsx (stop selecting *, disable parallel sync starts, optional sequential sync UX)
- src/pages/PropertyDetail.tsx (cooldown on OAuth errors for property-level sync)
- (Optional) src/components/ListingCalendar.tsx (cooldown on OAuth errors)

Expected outcome
- OAuth token requests drop from “one per function invocation” to “one per account per token lifetime”, even if users click multiple sync buttons.
- If Guesty does rate-limit OAuth anyway, we:
  - persist cooldown centrally and prevent further OAuth calls during that period,
  - return a consistent, clean user message instead of repeated failures.
