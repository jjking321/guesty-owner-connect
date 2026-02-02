

# Extend Reviews Sync to 2 Years and Add "Sync New Reviews"

## Overview

This plan implements two changes:
1. Update the Settings page reviews sync to fetch 2 years of history (matching reservations)
2. Create a new "sync-new-reviews" function for incremental sync from the Reviews page

---

## Changes Required

### 1. Update sync-reviews to Support 2-Year Lookback

**File**: `supabase/functions/sync-reviews/index.ts`

Current behavior:
- `daysSince` defaults to 30 days
- Maximum capped at 365 days

Changes:
- Increase the max cap from 365 to 730 days (2 years)
- When called from Settings page, pass `daysSince: 730`

```typescript
// Line 578: Change validation cap from 365 to 730
const validDaysSince = Math.max(1, Math.min(730, Number(daysSince) || 30));
```

### 2. Update Settings Page to Pass 730 Days

**File**: `src/pages/Settings.tsx`

Current call:
```typescript
body: { guestyAccountId: accountId }
```

Updated call:
```typescript
body: { guestyAccountId: accountId, daysSince: 730 }
```

---

### 3. Create sync-new-reviews Edge Function

**New File**: `supabase/functions/sync-new-reviews/index.ts`

This function will:
1. Find the most recent review date in the database for the account
2. Query Guesty for reviews created/updated since that date
3. Upsert only the new reviews

Logic pattern (following sync-new-reservations):
- Query `reviews` table for latest `imported_at` or `review_date`
- Use that as the `startDate` for Guesty API query
- If no existing reviews found, return error requiring initial sync first
- Sync type: `new_reviews`

---

### 4. Add "Sync New Reviews" Button to Reviews Page

**File**: `src/pages/Reviews.tsx`

Add a sync button in the header area that:
- Calls the `sync-new-reviews` edge function
- Shows loading state during sync
- Displays toast notifications for success/failure
- Gets the guesty_account_id from the listings (or a separate query)

UI additions:
- "Sync New Reviews" button in the header (similar to how PropertyDetail has sync buttons)
- Loading spinner during sync
- Toast feedback

---

## Technical Details

### sync-new-reviews Function Structure

```text
sync-new-reviews/index.ts
|
+-- GET most recent review imported_at from reviews table
|
+-- IF no reviews exist -> return error "Run initial sync first"
|
+-- GET Guesty account credentials
|
+-- GET OAuth token (using cached token manager)
|
+-- FETCH reviews from Guesty with startDate = most recent review date
|
+-- FILTER to this account's listings
|
+-- LOOKUP guest names from reservations table
|
+-- UPSERT new reviews
|
+-- UPDATE sync_jobs progress
```

### Reviews Page Changes

Add state and handlers:
```typescript
const [syncingReviews, setSyncingReviews] = useState(false);
const [guestyAccountId, setGuestyAccountId] = useState<string | null>(null);

// Fetch guesty account ID on load
useEffect(() => {
  // Get account from listings or guesty_accounts table
}, []);

const handleSyncNewReviews = async () => {
  // Call sync-new-reviews function
  // Handle success/error with toast
};
```

Add button in header:
```jsx
<Button onClick={handleSyncNewReviews} disabled={syncingReviews || !guestyAccountId}>
  {syncingReviews ? <Loader2 className="animate-spin" /> : <RefreshCw />}
  Sync New Reviews
</Button>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reviews/index.ts` | Increase daysSince max from 365 to 730 |
| `src/pages/Settings.tsx` | Pass `daysSince: 730` to sync-reviews call |
| `supabase/functions/sync-new-reviews/index.ts` | **NEW** - Incremental review sync |
| `src/pages/Reviews.tsx` | Add "Sync New Reviews" button and handler |

---

## Expected Outcome

After implementation:
1. **Settings page**: "Sync Reviews" button fetches 2 years of review history
2. **Reviews page**: "Sync New Reviews" button fetches only reviews since last sync (fast, incremental)
3. Same guest name and platform formatting logic in both functions
