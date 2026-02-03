
# Fix Booking.com Review Ratings (10-Point Scale)

## Problem

Booking.com reviews are showing 0 ratings because:
1. Booking.com uses a 10-point scale (0-10) instead of 5 stars
2. The sync functions only look for `overall_rating` and `starRatingOverall` fields - but Booking.com reviews likely store ratings in a different field (e.g., `score`, `average_score`, `overall_score`)
3. All 603 Booking.com reviews have `null` ratings in the database

---

## Solution Overview

1. Update sync functions to extract Booking.com ratings from the correct API field
2. Normalize the 10-point scale to 5-star (divide by 2) for consistent display
3. Update the database function to handle null ratings gracefully
4. Re-sync reviews to populate the missing ratings

---

## Changes Required

### 1. Update sync-reviews to Extract Booking.com Ratings

**File**: `supabase/functions/sync-reviews/index.ts`

Update the rating extraction logic to check additional fields that Booking.com might use:

```typescript
// Extract rating from multiple possible fields
let rating = null;

// Airbnb/VRBO: overall_rating or starRatingOverall (1-5 scale)
if (typeof rawReview.overall_rating === 'number') {
  rating = rawReview.overall_rating;
} else if (rawReview.starRatingOverall) {
  rating = parseFloat(rawReview.starRatingOverall);
}

// Booking.com: score or average_score (10-point scale) - normalize to 5
if (rating === null) {
  const bookingScore = rawReview.score ?? rawReview.average_score ?? rawReview.overall_score ?? rawReview.total_score;
  if (typeof bookingScore === 'number') {
    // Normalize 10-point scale to 5-star scale
    rating = bookingScore / 2;
  }
}

// Also check top-level score field (some channel integrations)
if (rating === null && typeof review.score === 'number') {
  if (review.score > 5) {
    rating = review.score / 2; // Normalize 10-point to 5-star
  } else {
    rating = review.score;
  }
}
```

### 2. Apply Same Fix to sync-new-reviews

**File**: `supabase/functions/sync-new-reviews/index.ts`

Mirror the same rating extraction logic changes.

### 3. Add Debug Logging for Missing Ratings

To help identify the correct field for future API changes, add logging when no rating is found:

```typescript
// Log review structure when rating is null (for debugging)
if (rating === null) {
  console.log(`No rating found for ${formatChannelId(review.channelId)} review:`, {
    reviewId: review._id,
    channelId: review.channelId,
    rawReviewKeys: Object.keys(rawReview),
    topLevelKeys: Object.keys(review),
  });
}
```

### 4. Update SQL Function to Exclude Null Ratings from Average

**File**: New migration

The current function includes null ratings in the count but they don't affect the average. Update to be more explicit:

```sql
CREATE OR REPLACE FUNCTION public.get_review_summary_stats(
  p_listing_id TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
-- ... existing structure ...

-- Update the rating_counts CTE to handle nulls better
rating_counts AS (
  SELECT
    COUNT(*) AS total,
    AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS avg_rat,
    COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 1) AS r1,
    COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 2) AS r2,
    COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 3) AS r3,
    COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 4) AS r4,
    COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 5) AS r5,
    COUNT(*) FILTER (WHERE rating IS NULL) AS r_null
  FROM filtered_reviews
),
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reviews/index.ts` | Add Booking.com rating extraction with 10-to-5 normalization |
| `supabase/functions/sync-new-reviews/index.ts` | Same rating extraction changes |
| New migration | Update `get_review_summary_stats` to handle nulls explicitly |

---

## After Implementation

After deploying the updated sync functions:
1. Run a full reviews sync from Settings to re-fetch all Booking.com reviews with their ratings
2. The ratings should now show correctly (normalized to 5-star scale)

---

## Technical Notes

- Booking.com's 10-point scale normalized: 10.0 becomes 5.0, 8.0 becomes 4.0, etc.
- The normalization happens at sync time, so all data in the database is stored on a consistent 5-star scale
- Existing null ratings will remain null until a re-sync is performed
