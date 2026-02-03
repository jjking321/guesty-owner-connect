
# Fix Missing Review Text for VRBO and Booking.com

## Problem Summary

Currently, 100% of VRBO (1,715) and Booking.com (603) reviews are missing their text content, while Airbnb reviews work correctly. This is because the sync function only extracts `rawReview.public_review`, which is an Airbnb-specific field name.

| Platform | Total Reviews | With Text | Missing Text |
|----------|---------------|-----------|--------------|
| Airbnb | 6,370 | 6,354 | 16 |
| Booking.com | 603 | 0 | 603 |
| VRBO | 1,715 | 0 | 1,715 |

## Root Cause

Line 515 in `sync-reviews/index.ts` (and the equivalent in `sync-new-reviews/index.ts`):

```typescript
review_text: rawReview.public_review || null,
```

This only works for Airbnb. Different platforms use different field names in the Guesty API's `rawReview` object.

---

## Solution

Create a helper function that extracts review text from multiple possible field locations based on platform-specific structures.

### Common Review Text Fields by Platform

- **Airbnb**: `public_review`
- **Booking.com**: `positive`, `negative`, `pros`, `cons`, `guest_comment`, `positive_guest_comment`, `negative_guest_comment`
- **VRBO/HomeAway**: `body`, `text`, `review_body`, `guestReview`, `headline` (combine with body)

### Implementation

**1. Create a helper function to extract review text:**

```typescript
function extractReviewText(rawReview: any, channelId: string): string | null {
  if (!rawReview) return null;
  
  const channel = (channelId || '').toLowerCase();
  
  // Airbnb: use public_review directly
  if (channel === 'airbnb' || channel === 'airbnb2') {
    return rawReview.public_review || null;
  }
  
  // Booking.com: combine positive and negative feedback
  if (channel === 'booking' || channel === 'bookingcom') {
    const parts: string[] = [];
    
    // Check various Booking.com field names
    const positive = rawReview.positive || rawReview.positive_guest_comment 
                     || rawReview.pros || rawReview.liked;
    const negative = rawReview.negative || rawReview.negative_guest_comment 
                     || rawReview.cons || rawReview.disliked;
    
    if (positive) parts.push(`Positive: ${positive}`);
    if (negative) parts.push(`Negative: ${negative}`);
    
    // Also check for a single combined field
    if (parts.length === 0) {
      return rawReview.guest_comment || rawReview.comment 
             || rawReview.text || rawReview.body || null;
    }
    
    return parts.length > 0 ? parts.join('\n\n') : null;
  }
  
  // VRBO/HomeAway: check body, text, guestReview fields
  if (channel === 'vrbo' || channel === 'homeaway' || channel === 'homeaway2') {
    const text = rawReview.body || rawReview.text || rawReview.review_body 
                 || rawReview.guestReview || rawReview.bodyText;
    const headline = rawReview.headline || rawReview.title;
    
    if (headline && text) {
      return `${headline}\n\n${text}`;
    }
    return text || headline || null;
  }
  
  // Fallback: try common field names
  return rawReview.public_review || rawReview.body || rawReview.text 
         || rawReview.comment || rawReview.review_text || null;
}
```

**2. Update the review mapping code:**

Replace line 515:
```typescript
// Before
review_text: rawReview.public_review || null,

// After
review_text: extractReviewText(rawReview, review.channelId),
```

**3. Add logging for debugging:**

When review text is still null, log the available rawReview keys to help identify missing field mappings:

```typescript
const reviewText = extractReviewText(rawReview, review.channelId);
if (!reviewText && Object.keys(rawReview).length > 0) {
  console.log(`No review text found for ${formatChannelId(review.channelId)}:`, {
    reviewId: review._id,
    rawReviewKeys: Object.keys(rawReview),
  });
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reviews/index.ts` | Add `extractReviewText` helper function, update review text extraction, add debug logging |
| `supabase/functions/sync-new-reviews/index.ts` | Same changes for incremental sync consistency |

---

## Post-Implementation Steps

After deploying, run a full review sync from Settings to re-fetch the reviews with proper text extraction. The sync will update existing reviews with the newly captured text content.
