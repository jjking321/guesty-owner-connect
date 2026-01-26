

## Property-Level Reservation Sync Feature (Updated with Verified Rate Limiting)

### Overview
Add a "Sync Reservations" button on the Property Detail page that fetches all reservations for that specific listing from Guesty, catching any missed bookings.

### Rate Limiting Implementation (Verified ✅)

The new edge function will use the **exact same pattern** from `sync-new-reservations/index.ts` (lines 28-202), which follows the custom knowledge requirements:

#### OAuth Token Fetching (`getGuestyAccessToken`)
```text
- MAX_RETRIES: 10 (not 5)
- BASE_DELAY_MS: 2000ms
- MAX_BACKOFF_MS: 30000ms (30s)
- MAX_WAIT_TIME_MS: 55000ms (55s, under 60s edge timeout)
- Exponential backoff: Math.min(2000 * Math.pow(2, attempt - 1), 30000)
- Error prefixes: OAUTH_RATE_LIMIT:, SERVER_ERROR:, AUTH_FAILED:
- Respects Retry-After headers (both numeric seconds and date formats)
- User-facing messages: "Please wait 3-5 minutes before trying again"
```

#### Data Fetching (`fetchGuestyData`)
```text
- MAX_RETRIES: 5
- BASE_DELAY_MS: 2000ms
- MAX_BACKOFF_MS: 30000ms
- MAX_WAIT_TIME_MS: 45000ms
- Retry on: 429, 502, 503, 504
- Logs rate limit headers: x-ratelimit-remaining-second/minute/hour
- Returns rateLimits object for adaptive delays
```

#### Adaptive Pagination Delay (`getAdaptiveDelay`)
```text
- If sec < 3: delay 1500ms
- If sec < 5: delay 1000ms
- If min < 10: delay 750ms
- Default: 500ms
```

#### Helper Functions
```text
- sleep(ms): Promise-based delay
- parseRetryAfter(header): Handles both numeric seconds and date formats
```

---

### Files to Create/Modify

#### 1. New Edge Function: `supabase/functions/sync-listing-reservations/index.ts`

Will copy these exact functions from `sync-new-reservations/index.ts`:
- Lines 28-102: `getGuestyAccessToken()` 
- Lines 104-106: `sleep()`
- Lines 108-118: `parseRetryAfter()`
- Lines 120-194: `fetchGuestyData()`
- Lines 196-202: `getAdaptiveDelay()`

Logic flow:
1. Accept `listingId` parameter
2. Query listings table to get `guesty_account_id`
3. Query guesty_accounts to get credentials
4. Call `getGuestyAccessToken()` with full retry logic
5. Fetch reservations with filter: `listingIds=[listingId]`
6. Paginate with `getAdaptiveDelay()` between pages
7. Upsert into reservations table
8. Database trigger auto-populates reservation_nights

#### 2. Update: `supabase/config.toml`

Add function configuration:
```toml
[functions.sync-listing-reservations]
verify_jwt = false
```

#### 3. Update: `src/pages/PropertyDetail.tsx`

- Import `RefreshCw` icon from lucide-react
- Add `useMutation` for sync operation
- Add sync button in Reservations tab header
- Show loading spinner during sync
- Toast success/error messages
- Invalidate `property-reservations` query on success

---

### Summary

| Component | Details |
|-----------|---------|
| `sync-listing-reservations/index.ts` | New edge function with **exact** rate limiting from sync-new-reservations |
| `supabase/config.toml` | Register new function |
| `src/pages/PropertyDetail.tsx` | Add sync button + mutation |

### Result
Users can click "Sync Reservations" on any property (like 102 Deleon) to fetch ALL reservations for that listing directly from Guesty, with the same robust rate limiting and retry logic used in the bulk sync.

