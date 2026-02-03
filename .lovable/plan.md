

# Filter Calculated Rating to Airbnb Reviews Only

## Problem

The "Calculated from synced reviews" comparison in the `LiveAirbnbRating` component currently includes reviews from **all platforms** (Airbnb, VRBO, Booking.com, etc.). This makes the comparison misleading since the live scraped rating only reflects Airbnb reviews.

**Current behavior:**
- Displays: "Calculated from synced reviews: 4.70 (69 reviews)"
- This includes VRBO, Booking.com, and all other platform reviews

**Expected behavior:**
- Should display: "Calculated from synced Airbnb reviews: 4.85 (42 reviews)"
- Only count reviews where `source` is `airbnb` or `airbnb2`

---

## Solution

Update the `ReviewsSection` component in `PropertyDetail.tsx` to filter reviews by Airbnb source before calculating the rating passed to `LiveAirbnbRating`.

---

## Implementation

### File: `src/pages/PropertyDetail.tsx`

**Change location:** Lines 1227-1233 in the `ReviewsSection` component

**Before:**
```typescript
// Calculate average rating from synced reviews (excluding removed)
const activeReviews = reviews.filter((r) => !r.is_removed && r.rating !== null);
const calculatedRating =
  activeReviews.length > 0
    ? activeReviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / activeReviews.length
    : undefined;
const calculatedCount = activeReviews.length;
```

**After:**
```typescript
// Calculate average rating from synced reviews (excluding removed)
const activeReviews = reviews.filter((r) => !r.is_removed && r.rating !== null);

// For comparison with live Airbnb rating, only use Airbnb reviews
const airbnbReviews = activeReviews.filter((r) => {
  const source = (r.source || '').toLowerCase();
  return source === 'airbnb' || source === 'airbnb2';
});
const calculatedAirbnbRating =
  airbnbReviews.length > 0
    ? airbnbReviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / airbnbReviews.length
    : undefined;
const calculatedAirbnbCount = airbnbReviews.length;
```

Then update the `LiveAirbnbRating` props:

**Before:**
```tsx
<LiveAirbnbRating
  listingId={listingId}
  calculatedRating={calculatedRating}
  calculatedCount={calculatedCount}
/>
```

**After:**
```tsx
<LiveAirbnbRating
  listingId={listingId}
  calculatedRating={calculatedAirbnbRating}
  calculatedCount={calculatedAirbnbCount}
/>
```

---

## UI Clarification (Optional)

Update the label in `LiveAirbnbRating.tsx` to be more explicit:

**Before (line 158-159):**
```tsx
<p className="text-sm text-muted-foreground">
  Calculated from synced reviews:{" "}
```

**After:**
```tsx
<p className="text-sm text-muted-foreground">
  Calculated from synced Airbnb reviews:{" "}
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/PropertyDetail.tsx` | Filter reviews to only Airbnb (`source === 'airbnb' || 'airbnb2'`) before calculating the rating passed to `LiveAirbnbRating` |
| `src/components/LiveAirbnbRating.tsx` | Update label text to clarify "synced Airbnb reviews" |

---

## Result

After this change, the Live Airbnb Rating card will show an accurate comparison:
- **Live rating**: Scraped directly from Airbnb listing page
- **Calculated rating**: Only from synced Airbnb reviews in the database

This allows you to identify discrepancies like removed reviews or sync gaps specifically for the Airbnb platform.

