

# Fix Sync Reviews Edge Function

## Problem Analysis

The current `sync-reviews` function iterates through each listing and queries the Guesty API with `listingId` parameter, but the API returns 0 reviews for every listing. After 223 listings, the sync completes with "Successfully synced 0 reviews from 223 listings".

From the logs:
```
Received 0 reviews for listing 68767954bfdf52002f6f35b1
Received 0 reviews for listing 64b986eb75f8b80034ada6e1
... (all 223 listings return 0 reviews)
```

## Root Cause

The Guesty Reviews API works better when queried **globally** with date filters rather than per-listing. The working pattern from your other project:

```
GET https://open-api.guesty.com/v1/reviews
Query Parameters:
- skip - Pagination offset (e.g., 0, 100, 200)
- limit - Page size (max 100)
- startDate - Filter by updatedAt from date
- endDate - Filter by updatedAt to date
```

## Solution

Rewrite the sync function to:
1. Query all reviews for the account without the listingId filter
2. Use startDate/endDate parameters to limit to past X days (user configurable)
3. Use skip/limit pagination (100 per page)
4. Continue using the existing OAuth token caching and rate limit handling

## Implementation Changes

### 1. Add daysSince Parameter

Allow users to specify how many days back to sync (default: 30 days).

```typescript
const { guestyAccountId, daysSince = 30 } = await req.json();
```

### 2. Rewrite fetchReviewsPage Function

Remove the listingId parameter and add date filters:

| Before | After |
|--------|-------|
| `url.searchParams.append('listingId', listingId)` | `url.searchParams.append('startDate', startDateISO)` |
| N/A | `url.searchParams.append('endDate', endDateISO)` |

```typescript
async function fetchReviewsPage(
  accessToken: string,
  limit: number,
  skip: number,
  startDate: string,
  endDate: string
) {
  const url = new URL('https://open-api.guesty.com/v1/reviews');
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('skip', skip.toString());
  url.searchParams.append('startDate', startDate);
  url.searchParams.append('endDate', endDate);
  // ... rest of fetch logic with rate limiting
}
```

### 3. Simplify performSync Function

Instead of looping through listings, fetch all reviews with pagination:

```typescript
async function performSync(
  guestyAccountId: string,
  syncJobId: string,
  daysSince: number
) {
  // Calculate date range
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000).toISOString();
  
  let totalReviewsSynced = 0;
  let currentOffset = 0;
  let hasMore = true;
  
  while (hasMore) {
    const reviewsData = await fetchReviewsPage(
      accessToken,
      REVIEWS_BATCH_SIZE, // 100
      currentOffset,
      startDate,
      endDate
    );
    
    const results = reviewsData.results || [];
    
    if (results.length === 0) {
      hasMore = false;
      break;
    }
    
    // Upsert reviews (filter to only this account's listings)
    // ... upsert logic
    
    totalReviewsSynced += results.length;
    currentOffset += results.length;
    
    // Update progress
    await updateSyncJobProgress(syncJobId, totalReviewsSynced);
    
    if (results.length < REVIEWS_BATCH_SIZE) {
      hasMore = false;
    }
    
    // Rate limit delay
    await delay(REQUEST_DELAY_MS);
  }
}
```

### 4. Keep Existing Token Caching

The OAuth token caching with single-flight lock is already implemented correctly.

### 5. Filter Reviews to Account's Listings

Since we're fetching all reviews without listingId filter, we need to ensure we only save reviews for listings that belong to this account:

```typescript
// Get list of this account's listing IDs
const { data: accountListings } = await supabase
  .from('listings')
  .select('id')
  .eq('guesty_account_id', guestyAccountId);

const accountListingIds = new Set(accountListings?.map(l => l.id) || []);

// Filter results to only this account's listings
const validReviews = results.filter(r => accountListingIds.has(r.listingId));
```

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reviews/index.ts` | Complete rewrite of fetch logic - remove per-listing loop, add date-based global query |

## API Request Pattern

| Parameter | Value |
|-----------|-------|
| Endpoint | `GET https://open-api.guesty.com/v1/reviews` |
| skip | 0, 100, 200, etc. |
| limit | 100 (max) |
| startDate | ISO date X days ago |
| endDate | Current ISO date |

## Rate Limiting (Preserved)

The existing rate limiting code is solid and will be preserved:
- Exponential backoff on 429 errors
- Rate limit header logging
- 500ms delay between requests
- Max 5 retries per request

## Expected Result

| Before | After |
|--------|-------|
| 223 API calls (one per listing) | ~1-10 API calls (paginated) |
| 0 reviews synced | All reviews from past X days |
| ~3 minutes runtime | ~10-30 seconds |

## UI Integration

The Settings page already has a reviews sync button. We could optionally add a dropdown to select how many days back to sync (7, 30, 90, all).

