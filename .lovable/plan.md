

# Fix VRBO and Booking.com Review Text Extraction

## Problem Summary

After the recent sync, reviews are showing incorrect text:

| Platform | Issue | Example |
|----------|-------|---------|
| VRBO | Shows `[object Object] [object Object]` | Fields like `body` or `text` are objects, not strings |
| Booking.com | Shows null (`No text provided`) | Content is nested under `rawReview.content`, not at root level |

## Root Cause Analysis

The `extractReviewText` function assumes flat field structures, but:

1. **Booking.com**: The Booking.com API (and therefore Guesty's passthrough) uses a `content` wrapper object:
   ```json
   {
     "rawReview": {
       "content": {
         "headline": "A room on the canal...",
         "positive": "It was great that...",
         "negative": "What I didn't like..."
       },
       "scoring": { ... }
     }
   }
   ```

2. **VRBO**: The review text fields may be objects with nested properties:
   ```json
   {
     "rawReview": {
       "body": { "text": "Actual review text here" },
       "headline": { "text": "Great stay!" }
     }
   }
   ```

## Solution

Update the `extractReviewText` function in both sync files to:

1. **Add robust string extraction helper** that handles objects with nested `text` properties
2. **Check `rawReview.content` for Booking.com** before checking root-level fields
3. **Add comprehensive debug logging** to capture actual field structures for future issues

---

## Implementation Details

### 1. Add Helper Function to Safely Extract String Values

```typescript
// Helper to safely extract string from potentially nested objects
function extractStringValue(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    // Try common nested text field names
    return value.text || value.value || value.body || 
           value.content || value.message || null;
  }
  return null;
}
```

### 2. Update extractReviewText Function

```typescript
function extractReviewText(rawReview: any, channelId: string): string | null {
  if (!rawReview) return null;
  
  const channel = (channelId || '').toLowerCase();
  
  // Airbnb: use public_review directly
  if (channel === 'airbnb' || channel === 'airbnb2') {
    return extractStringValue(rawReview.public_review);
  }
  
  // Booking.com: content is nested under rawReview.content
  if (channel === 'booking' || channel === 'bookingcom') {
    const content = rawReview.content || rawReview;
    const parts: string[] = [];
    
    const headline = extractStringValue(content.headline);
    const positive = extractStringValue(content.positive) || 
                     extractStringValue(content.pros);
    const negative = extractStringValue(content.negative) || 
                     extractStringValue(content.cons);
    
    if (headline) parts.push(headline);
    if (positive) parts.push(`Positive: ${positive}`);
    if (negative) parts.push(`Negative: ${negative}`);
    
    if (parts.length > 0) return parts.join('\n\n');
    
    // Fallback to combined comment fields
    return extractStringValue(content.guest_comment) || 
           extractStringValue(content.comment) || null;
  }
  
  // VRBO/HomeAway: fields may be objects with nested text
  if (channel === 'vrbo' || channel === 'homeaway' || channel === 'homeaway2') {
    const headline = extractStringValue(rawReview.headline) || 
                     extractStringValue(rawReview.title);
    const body = extractStringValue(rawReview.body) || 
                 extractStringValue(rawReview.text) || 
                 extractStringValue(rawReview.reviewText) ||
                 extractStringValue(rawReview.guestReview);
    
    if (headline && body) return `${headline}\n\n${body}`;
    return body || headline || null;
  }
  
  // Fallback: try common field names
  return extractStringValue(rawReview.public_review) || 
         extractStringValue(rawReview.body) || 
         extractStringValue(rawReview.text) || 
         extractStringValue(rawReview.comment) || null;
}
```

### 3. Add Enhanced Debug Logging

Add logging to capture the actual structure when extraction fails, including a JSON snippet of the rawReview:

```typescript
if (!reviewText && Object.keys(rawReview).length > 0) {
  const channel = (review.channelId || '').toLowerCase();
  if (channel !== 'airbnb' && channel !== 'airbnb2') {
    // Log more details about the actual structure
    console.log(`No review text for ${formatChannelId(review.channelId)}:`, {
      reviewId: review._id,
      rawReviewKeys: Object.keys(rawReview),
      contentKeys: rawReview.content ? Object.keys(rawReview.content) : null,
      bodyType: typeof rawReview.body,
      textType: typeof rawReview.text,
      // Sample first 200 chars of stringified rawReview for debugging
      rawSample: JSON.stringify(rawReview).slice(0, 200),
    });
  }
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reviews/index.ts` | Add `extractStringValue` helper, update `extractReviewText` function, enhance debug logging |
| `supabase/functions/sync-new-reviews/index.ts` | Same changes for consistency |

---

## Post-Implementation Steps

After deploying the updated functions:

1. **Run a full review sync** from Settings to re-process all reviews
2. **Check edge function logs** for any remaining `No review text` debug messages
3. **Verify database** - VRBO and Booking.com reviews should now have proper text content

---

## Why This Fix Works

The key insight is that different platforms have different data structures:

- **Airbnb**: Flat structure with `public_review` as a string
- **Booking.com**: Nested `content` object containing `positive`, `negative`, `headline`
- **VRBO**: Fields may be objects like `{ text: "..." }` instead of direct strings

The `extractStringValue` helper handles all these cases by:
1. Returning strings directly
2. Extracting `.text` or `.value` from objects
3. Returning null for anything else

