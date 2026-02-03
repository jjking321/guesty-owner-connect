

# Add Nightly Airbnb Ratings Scrape

## Overview

Add automated nightly scraping of Airbnb ratings to the existing nightly sync orchestrator. The scrape will run after the other Guesty syncs complete, ensuring ratings are updated daily without manual intervention.

---

## Current Architecture

```text
Cron (3 AM UTC)
    |
    v
nightly-sync (orchestrator)
    |
    +--> sync-guesty-data (listings)
    |        [polls sync_jobs until complete]
    |
    +--> sync-new-reservations
    |        [polls sync_jobs until complete]
    |
    +--> sync-owners
    |        [waits 10s]
    |
    +--> sync-bulk-calendar
             [polls sync_jobs until complete]
```

## Proposed Addition

```text
nightly-sync (orchestrator)
    |
    ... existing syncs ...
    |
    +--> NEW: bulk-scrape-airbnb-ratings
             [polls sync_jobs until complete]
             [runs ONCE per org, not per account]
```

---

## Technical Challenges

### 1. Authentication for Automated Runs

The current `bulk-scrape-airbnb-ratings` function requires user JWT authentication. For automated nightly runs, we need to support service-role authentication similar to `sync-bulk-calendar`.

**Solution:** Add `x-service-role: true` header support that bypasses user JWT validation and uses service role key to identify the organization.

### 2. Large Portfolio Timeout Prevention

The function already uses self-invocation with batch processing (15 listings per batch, 3s delay between requests). For automated runs, the self-invocation must also use service-role auth.

**Solution:** Pass `x-service-role` header in self-invocations during automated runs.

### 3. Single Run Across All Accounts

Unlike Guesty syncs which run per-account, Airbnb scraping queries all listings across all accounts in an organization. The nightly sync should invoke this once after processing all accounts.

---

## Technical Changes

### 1. Modify `bulk-scrape-airbnb-ratings/index.ts`

Add service-role authentication support:

```typescript
// Check for service-role bypass (for automated nightly sync)
const isServiceRole = req.headers.get("x-service-role") === "true";

if (isServiceRole) {
  // Get organization from first active guesty account
  const { data: account } = await supabaseAdmin
    .from("guesty_accounts")
    .select("organization_id, id")
    .eq("automated_sync_enabled", true)
    .limit(1)
    .maybeSingle();
  
  if (!account) {
    return new Response(
      JSON.stringify({ error: "No account with automation enabled" }),
      { status: 400, ... }
    );
  }
  organizationId = account.organization_id;
  guestyAccountId = account.id;
} else {
  // Existing user auth logic
  const authHeader = req.headers.get("Authorization");
  // ... validate user and get organization
}
```

Pass service-role header in self-invocation:

```typescript
// Self-invoke to continue
const headers: Record<string, string> = {
  "Content-Type": "application/json",
};

if (isServiceRole) {
  headers["x-service-role"] = "true";
} else {
  headers["Authorization"] = authHeader!;
}

await fetch(`${supabaseUrl}/functions/v1/bulk-scrape-airbnb-ratings`, {
  method: "POST",
  headers,
  body: JSON.stringify({}),
});
```

### 2. Modify `nightly-sync/index.ts`

Add Airbnb ratings scrape after all accounts are processed:

```typescript
// After the account loop completes...

// 5. Scrape Airbnb Ratings (runs once for entire org, not per account)
console.log(`\n--- Scraping Airbnb Ratings ---`);
const firstAccountId = accounts[0]?.id;

if (firstAccountId) {
  const { error: airbnbInvokeError } = await supabase.functions.invoke(
    'bulk-scrape-airbnb-ratings',
    {
      body: {},
      headers: { 'x-service-role': 'true' }
    }
  );

  if (airbnbInvokeError) {
    console.error('Failed to invoke Airbnb ratings scrape:', airbnbInvokeError);
  } else {
    // Poll for completion
    await waitForSyncCompletion(
      supabase,
      firstAccountId,
      'airbnb_ratings',
      1200000 // 20 min timeout (225 listings * 3s each = ~11 min)
    );
  }
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/bulk-scrape-airbnb-ratings/index.ts` | Add service-role auth support and pass header in self-invocations |
| `supabase/functions/nightly-sync/index.ts` | Add Airbnb ratings scrape step after all account syncs |

---

## UI Updates (Optional Enhancement)

The Settings page already displays the last Airbnb scrape timestamp. No UI changes are strictly required, but we could add:

- Display "Auto" badge next to Airbnb ratings section (similar to Guesty accounts)
- Show last automated scrape timestamp

---

## Execution Order

The nightly sync will now run in this order:

1. **Per Account Loop:**
   - Sync Listings
   - Sync New Reservations  
   - Sync Owners
   - Sync Calendar

2. **After All Accounts:**
   - Scrape Airbnb Ratings (single run for entire portfolio)

---

## Timeout Considerations

| Sync Type | Listings | Time Estimate | Timeout |
|-----------|----------|---------------|---------|
| Listings | 225 | ~30s | 10 min |
| Reservations | ~500 new | ~2 min | 10 min |
| Owners | ~50 | ~10s | 10s fixed |
| Calendar | 225 | ~10 min | 15 min |
| **Airbnb Ratings** | **225** | **~11 min** | **20 min** |

The 20-minute timeout provides buffer for the 225 listings at 3s each (~11 min total).

---

## Error Handling

- If Airbnb scrape fails, it will be logged but won't affect the success status of other syncs
- Individual listing scrape failures are tracked per-listing with `live_rating_scrape_error`
- Job status will be `completed_with_errors` if some listings fail
- Failed jobs can be resumed manually via the Resume button in UI

