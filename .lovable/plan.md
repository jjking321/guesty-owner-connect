
# Fix Reviews Sync - API Response Mapping

## Problem Identified
The reviews sync completes but fetches 0 reviews because the code is parsing the API response incorrectly:

1. **Response wrapper**: Code expects `reviewsData.results` but the API returns `reviewsData.data`
2. **Field mapping**: The field names in the code don't match the actual Guesty API response structure

## Working API Reference (from your other project)
```
GET https://open-api.guesty.com/v1/reviews?skip={skip}&limit={limit}&startDate={fromDate}&endDate={toDate}

Response:
{
  "data": [
    {
      "_id": "guesty_review_id",
      "reservationId": "res_123",
      "listingId": "listing_456",
      "channelId": "airbnb",
      "source": "Airbnb",
      "guestId": "guest_789",
      "rawReview": {
        "overall_rating": 3,
        "public_review": "The place was okay but...",
        "starRatingOverall": "3",
        "reviewer": {
          "first_name": "John",
          "name": "John Doe"
        }
      },
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

## Changes Required

### File: `supabase/functions/sync-reviews/index.ts`

**1. Fix response parsing (line 368)**
- Change from: `const results = reviewsData.results || [];`
- Change to: `const results = reviewsData.data || [];`

**2. Fix field mapping (lines 385-397)**
Update the review object mapping to extract data from `rawReview`:

```text
Current Mapping          ->  Correct Mapping
------------------------------------------------------
review._id                   review._id (correct)
review.listingId             review.listingId (correct)
review.reservationId         review.reservationId (correct)
review.guestName             review.rawReview?.reviewer?.name 
                             || review.rawReview?.reviewer?.first_name
review.rating                review.rawReview?.overall_rating 
                             || parseFloat(review.rawReview?.starRatingOverall)
review.review                review.rawReview?.public_review
review.source                review.source (correct)
review.createdAt             review.createdAt (correct)
review.publicReply           review.rawReview?.private_feedback (if exists)
review.categories            review.rawReview (store full object for category extraction)
```

**3. Add debug logging**
Add a log statement to print the first review object received, so we can verify the exact structure if needed.

## Technical Details

The updated mapping code will look like:

```typescript
const reviewsToInsert = validReviews.map((review: any) => {
  const rawReview = review.rawReview || {};
  const reviewer = rawReview.reviewer || {};
  
  // Extract rating from multiple possible fields
  let rating = null;
  if (typeof rawReview.overall_rating === 'number') {
    rating = rawReview.overall_rating;
  } else if (rawReview.starRatingOverall) {
    rating = parseFloat(rawReview.starRatingOverall);
  }
  
  return {
    id: review._id,
    guesty_account_id: guestyAccountId,
    listing_id: review.listingId,
    reservation_id: review.reservationId || null,
    guest_name: reviewer.name || reviewer.first_name || null,
    rating: rating,
    review_text: rawReview.public_review || null,
    response_text: rawReview.private_feedback || null,
    review_date: review.createdAt || null,
    source: review.source || null,
    category_ratings: rawReview.category_ratings || null,
  };
});
```

## Expected Outcome
After this fix, running the reviews sync should:
- Successfully parse the `data` array from the API response
- Correctly extract guest name, rating, and review text from the `rawReview` object
- Store reviews in the database with proper field values
