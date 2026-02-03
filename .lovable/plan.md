

# Add Bulk Airbnb Rating Scrape with Auto-Continuation

## Overview

Add a "Scrape Airbnb Ratings" button to the Settings page that will automatically process all listings with an `airbnb_listing_id`. The function will use the **self-invocation pattern** (like `sync-bulk-calendar` and `sync-guesty-data`) to automatically continue processing without needing to be run multiple times.

---

## Architecture

```text
Settings Page
      |
      v
"Scrape Airbnb Ratings" button
      |
      v
bulk-scrape-airbnb-ratings (new edge function)
      |
      +-- Create sync_job for progress tracking
      |
      +-- Query listings with airbnb_listing_id
      |
      +-- Loop through listings (BATCH_SIZE = 15)
      |         |
      |         +-- Fetch Airbnb page
      |         +-- Extract rating data (reuse existing logic)
      |         +-- Update listing
      |         +-- 3-second delay between requests
      |         +-- Update sync_job progress
      |
      +-- Before timeout: SELF-INVOKE with offset  <-- AUTO-CONTINUATION
      |
      v
Continues automatically until all listings processed
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Self-invocation pattern** | Handles portfolios of any size without user intervention |
| **3-second delay between requests** | Avoids Airbnb rate limiting/blocking |
| **BATCH_SIZE = 15** | ~45 seconds of scraping per batch (15 x 3s), leaves buffer before 60s timeout |
| **Skip recently scraped (24h)** | Avoids redundant scraping, allows re-running to pick up missed listings |
| **Organization-scoped** | Scrapes all listings for the user's organization, not per-account |

---

## Implementation Details

### 1. New Edge Function: `bulk-scrape-airbnb-ratings`

**File:** `supabase/functions/bulk-scrape-airbnb-ratings/index.ts`

Key components:
- Reuse the `extractRatingFromHtml()` function from `scrape-airbnb-rating`
- Create/resume a `sync_job` with type `airbnb_ratings`
- Track progress with `last_synced_offset` for resumability
- Self-invoke before timeout to continue processing
- Pass auth token in headers for self-invocation (per project pattern)

```typescript
// Constants
const BATCH_SIZE = 15;  // Process 15 listings per invocation
const DELAY_BETWEEN_REQUESTS = 3000;  // 3 seconds
const SKIP_IF_SCRAPED_WITHIN_HOURS = 24;

// Self-invocation pattern (simplified)
for (let i = offset; i < listings.length; i++) {
  // Process listing...
  
  // Check if we've processed enough for this batch
  if ((i - offset + 1) >= BATCH_SIZE && i < listings.length - 1) {
    // Update job with current offset
    await updateSyncJob(supabase, jobId, {
      items_synced: i + 1,
      last_synced_offset: i + 1,
      progress_message: `Processed ${i + 1}/${total}. Continuing...`,
    });
    
    // Self-invoke to continue
    await supabase.functions.invoke('bulk-scrape-airbnb-ratings', {
      headers: { Authorization: authToken },
      body: { organizationId },
    });
    
    return; // Exit this invocation
  }
}
```

### 2. Update Settings Page

**File:** `src/pages/Settings.tsx`

Add:
- New state: `scrapingAirbnbRatings`
- New handler: `handleScrapeAirbnbRatings()`
- New button with Airbnb icon in a separate section (since this is org-wide, not per-account)
- Display last scrape info

The button will be placed in a new card section since Airbnb rating scraping is organization-wide (not per Guesty account).

### 3. Update SyncProgressCard

**File:** `src/components/SyncProgressCard.tsx`

Add `airbnb_ratings` to the supported sync types:
- Update the `syncType` union type to include `'airbnb_ratings'`
- Add display name: `'airbnb_ratings'` -> `'Airbnb Ratings Scrape'`
- Add resume handler for `airbnb_ratings` sync type

### 4. Config Update

**File:** `supabase/config.toml`

```toml
[functions.bulk-scrape-airbnb-ratings]
verify_jwt = true
```

---

## UI Changes

### New Section in Settings Page

A new card will be added below the Guesty Accounts section:

```text
+-------------------------------------------------------------------------+
| Airbnb Ratings                                                          |
| Scrape live ratings directly from Airbnb for all your listings          |
+-------------------------------------------------------------------------+
| Last scraped: Jan 15, 2026 3:45 PM                                     |
|                                                                         |
| [Scrape Airbnb Ratings]                                                |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | Airbnb Ratings Scrape - running                        [45 / 272]  | |
| | Processing: Beach House Paradise                                   | |
| | [========>                                            ] 16%        | |
| +---------------------------------------------------------------------+ |
+-------------------------------------------------------------------------+
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/bulk-scrape-airbnb-ratings/index.ts` | **Create** | New edge function with self-invocation pattern |
| `supabase/config.toml` | **Modify** | Add function configuration |
| `src/pages/Settings.tsx` | **Modify** | Add new section with button and progress card |
| `src/components/SyncProgressCard.tsx` | **Modify** | Add `airbnb_ratings` sync type support |

---

## Edge Function Flow

1. **Initial call**: Create sync_job, query listings, start processing
2. **Each listing**: Fetch Airbnb page, extract rating, update listing, wait 3s
3. **After BATCH_SIZE**: Save offset, self-invoke, exit
4. **Resume call**: Find existing running job, continue from offset
5. **Final batch**: Mark job complete, update timestamp

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Airbnb blocks (403/429) | Log error, continue to next listing |
| Extraction fails | Store error in `live_rating_scrape_error`, continue |
| No Airbnb ID | Skip listing automatically |
| Self-invocation fails | Job stays in running state with offset; user can resume manually |
| User clicks Stop | Job checks status before each listing, stops gracefully |

---

## Rate Limiting Strategy

- **3-second delay** between requests to avoid Airbnb blocking
- **Skip recently scraped** listings (within 24 hours) to avoid redundant requests
- **Browser-like headers** on all requests (already implemented in existing scraper)
- **Graceful continuation** on errors (don't stop the entire batch for one failure)

---

## Expected Performance

| Portfolio Size | Batches Required | Total Time |
|----------------|------------------|------------|
| 50 listings | 4 batches | ~3 minutes |
| 150 listings | 10 batches | ~8 minutes |
| 300 listings | 20 batches | ~15 minutes |

All automatic, no user intervention required after clicking the button.

