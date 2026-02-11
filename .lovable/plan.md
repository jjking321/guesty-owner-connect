

# Add Reviews to Nightly Sync + Fix Airbnb Scrape 401

## Problem 1: Reviews Not in Nightly Pipeline
The nightly sync pipeline runs: Listings -> Reservations -> Owners -> Calendar, then Airbnb Ratings -> Probabilities -> Forecasts -> Actionables. Reviews are never synced automatically.

## Problem 2: Airbnb Scrape Self-Invocation Fails with 401
The `bulk-scrape-airbnb-ratings` function has `verify_jwt = true` in config.toml. When it self-invokes to process the next batch, it only passes `x-service-role: true` (no JWT token), so the self-invocation gets rejected with a 401. This means only 15 of 198 listings get scraped before it dies.

---

## Fix 1: Add Reviews Phase to Account Syncs

### Changes to `supabase/functions/nightly-sync/index.ts`:

**Update the phase order** (line 19):
```
'listings' -> 'reservations' -> 'owners' -> 'calendar' -> 'reviews' -> 'done'
```

**Update `getNextPhase()`** to include `reviews` after `calendar`.

**Update `getSyncType()`** to map `reviews` -> `'new_reviews'` (matching the sync_type used by sync-new-reviews).

**Update `processAccountSyncs()`** to fire `sync-new-reviews` when entering the reviews phase, similar to how it fires other syncs. Since owners is treated as "assumed complete", reviews will follow calendar.

### Changes to `supabase/functions/sync-new-reviews/index.ts`:

**Add service-role authentication support** (like other sync functions have). When invoked with `x-service-role: true` header, skip user auth and use the service role client directly. The function already creates a `supabaseAdmin` client with service role key, so the main change is the auth gate at the top of `Deno.serve`.

### Changes to `supabase/config.toml`:

Set `verify_jwt = false` for `sync-new-reviews` so the nightly orchestrator can invoke it without a user JWT. Auth will be validated in code.

---

## Fix 2: Fix Airbnb Scrape Self-Invocation Auth

### Changes to `supabase/config.toml`:

Set `verify_jwt = false` for `bulk-scrape-airbnb-ratings`. Auth is already validated in code (it checks for service-role header or user auth).

### Changes to `supabase/functions/bulk-scrape-airbnb-ratings/index.ts`:

Update the self-invocation to include the `Authorization` header with the service role key when running in service-role mode, so it passes JWT validation. Actually, since we're setting `verify_jwt = false`, the existing `x-service-role` header approach will work. No code changes needed here -- the config.toml change is sufficient.

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/config.toml` | Set `verify_jwt = false` for `bulk-scrape-airbnb-ratings` and `sync-new-reviews` |
| `supabase/functions/nightly-sync/index.ts` | Add `reviews` phase after `calendar` in account sync pipeline |
| `supabase/functions/sync-new-reviews/index.ts` | Add service-role auth support for automated invocation |

## Expected Result

- Nightly sync will now automatically pull new reviews for each account after calendar sync completes
- Airbnb scrape will successfully self-invoke through all 198 listings instead of stopping at 15
- The orchestrator monitors review sync completion via `isSyncComplete()` checking for `new_reviews` sync_type (already used by the function)

