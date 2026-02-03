

# Scrape Live Airbnb Review Scores (Free - Native Fetch)

## Overview

Use native `fetch()` in a Supabase Edge Function to scrape the live Airbnb listing page and extract the review score from embedded JSON data. This approach is completely free and doesn't require any external paid service.

## How It Works

Airbnb pages include initial listing data in a `<script>` tag (typically `type="application/json"` with an id like `data-injector-state` or similar). This JSON contains the review rating and count. We'll:

1. Fetch the raw HTML of the Airbnb listing page
2. Parse the HTML to find the embedded JSON script tags
3. Extract the rating and review count from the JSON
4. Save to the database

---

## Technical Approach

### Scraping Strategy

```text
Edge Function (Deno)
        |
        v
  fetch('https://airbnb.com/rooms/{id}')
        |
        v
  Parse HTML for <script> tags containing listing data
        |
        v
  Extract rating & review count from JSON
        |
        v
  Update listings table
```

### Key Implementation Details

The Edge Function will:

1. **Fetch with browser-like headers** to avoid basic bot detection:
   ```typescript
   const response = await fetch(url, {
     headers: {
       'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
       'Accept': 'text/html,application/xhtml+xml',
       'Accept-Language': 'en-US,en;q=0.9',
     },
   });
   ```

2. **Parse the HTML** using regex to find embedded JSON:
   ```typescript
   // Look for patterns like data-state or __NEXT_DATA__ or deferred-state
   const jsonMatch = html.match(/"reviewsModule".*?"rating":(\d+\.?\d*).*?"count":(\d+)/);
   // Or look in script tags with listing data
   ```

3. **Multiple extraction strategies** (fallback chain):
   - Look for `reviewsModule` in embedded state
   - Look for `overallRating` in listing data
   - Parse meta tags as last resort

---

## Implementation Steps

### 1. Database Changes

Add columns to the `listings` table:

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_airbnb_rating numeric(3,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_airbnb_review_count integer;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_rating_scraped_at timestamptz;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_rating_scrape_error text;
```

### 2. New Edge Function: `scrape-airbnb-rating`

**File:** `supabase/functions/scrape-airbnb-rating/index.ts`

```typescript
// Pseudocode structure
Deno.serve(async (req) => {
  // 1. Get listingId from request
  // 2. Look up airbnb_listing_id from listings table
  // 3. Fetch Airbnb page with browser-like headers
  // 4. Parse HTML to find embedded JSON data
  // 5. Extract rating and review count
  // 6. Update listings table
  // 7. Return result
});
```

**Extraction Logic:**
```typescript
function extractRatingFromHtml(html: string): { rating: number; count: number } | null {
  // Strategy 1: Look for rating in JSON state
  const stateMatch = html.match(/"overallRating":\s*(\d+\.?\d*)/);
  const countMatch = html.match(/"reviewCount":\s*(\d+)/);
  
  // Strategy 2: Look for structured data (JSON-LD)
  const ldMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  
  // Strategy 3: Parse meta tags
  const metaMatch = html.match(/content="(\d+\.?\d*) out of 5"/);
  
  // Return first successful extraction
}
```

### 3. Frontend Updates

**File:** `src/pages/PropertyDetail.tsx`

Add to the Reviews tab:

1. **Query for live rating data:**
   ```typescript
   const { data: listing } = useQuery({
     queryKey: ['listing-live-rating', listingId],
     queryFn: async () => {
       const { data } = await supabase
         .from('listings')
         .select('live_airbnb_rating, live_airbnb_review_count, live_rating_scraped_at, airbnb_listing_id')
         .eq('id', listingId)
         .single();
       return data;
     },
   });
   ```

2. **Mutation to trigger scrape:**
   ```typescript
   const scrapeMutation = useMutation({
     mutationFn: async () => {
       const { data, error } = await supabase.functions.invoke('scrape-airbnb-rating', {
         body: { listingId },
       });
       return data;
     },
   });
   ```

3. **Display component** showing:
   - Live Airbnb rating with Airbnb icon
   - Review count
   - Last scraped timestamp
   - Refresh button
   - Comparison with calculated rating
   - Error message if scrape failed

---

## UI Design

```text
+------------------------------------------------------------------+
| Live Airbnb Rating                                    [Refresh ⟳] |
+------------------------------------------------------------------+
| [Airbnb Icon] ★ 4.92  (328 reviews on Airbnb)                    |
| Last checked: 2 hours ago                                         |
|                                                                   |
| Calculated from synced reviews: ★ 4.87 (340 reviews)             |
| Difference: +0.05 rating, -12 reviews                            |
+------------------------------------------------------------------+
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| Database migration | Create | Add 4 new columns to `listings` table |
| `supabase/functions/scrape-airbnb-rating/index.ts` | Create | Edge function to scrape Airbnb page |
| `supabase/config.toml` | Modify | Add function configuration |
| `src/pages/PropertyDetail.tsx` | Modify | Add live rating display and refresh button |

---

## Limitations & Considerations

| Consideration | Details |
|---------------|---------|
| **Anti-bot protection** | Airbnb may block requests; we'll use browser-like headers to minimize this |
| **Page structure changes** | If Airbnb changes their HTML, extraction may break; multiple fallback strategies help |
| **Rate limiting** | Manual refresh only (no batch scraping) to avoid triggering blocks |
| **Only Airbnb** | This approach only works for Airbnb; VRBO/Booking would need different parsing |

---

## Fallback Behavior

If scraping fails:
1. Store the error message in `live_rating_scrape_error`
2. Show "Unable to fetch live rating" in the UI
3. Still show the calculated rating from synced reviews
4. Allow retry via refresh button

