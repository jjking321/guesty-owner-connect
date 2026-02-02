
# Fix Reviews - Guest Names and Platform Display

## Problem Summary
The reviews table shows "Unknown" for guest names and blank for platform because:
1. **Platform**: The API returns `channelId` (e.g., "airbnb2") but the code was looking for `review.source` which doesn't exist
2. **Guest Name**: The Guesty reviews API doesn't include guest name - only a `guestId` reference. However, the **reservations** API includes `guest.fullName`

## Solution Approach
Instead of making additional API calls to fetch guest info, we'll:
1. Add `guest_name` to the reservations table
2. Update reservation sync to capture `guest.fullName` 
3. In reviews sync, join with reservations table to get guest name via `reservation_id`
4. Fix the platform/source mapping to use `channelId`

---

## Changes Required

### 1. Database Migration - Add guest_name to reservations

```sql
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_name TEXT;
```

### 2. Update sync-guesty-data Edge Function

Add `guest.fullName` to the fields requested and map it during upsert.

**File**: `supabase/functions/sync-guesty-data/index.ts`

Changes:
- Add `guest.fullName` to the API fields parameter
- Map `reservation.guest?.fullName` to `guest_name` in the upsert

### 3. Update sync-listing-reservations Edge Function

Same changes for per-listing reservation sync.

**File**: `supabase/functions/sync-listing-reservations/index.ts`

Changes:
- Add `guest.fullName` to the API fields parameter  
- Map the guest name in the upsert

### 4. Update sync-reviews Edge Function

**File**: `supabase/functions/sync-reviews/index.ts`

Changes:
- After fetching reviews, collect all `reservation_id` values
- Query the reservations table to get guest names
- Create a map of reservation_id to guest_name
- Update field mapping:
  - `source`: Use `formatChannelId(review.channelId)` instead of `review.source`
  - `guest_name`: Look up from reservations map, with fallback to rawReview.reviewer

Add channel ID formatter helper:
```typescript
function formatChannelId(channelId: string | null): string {
  if (!channelId) return 'Unknown';
  const channelMap: Record<string, string> = {
    'airbnb': 'Airbnb',
    'airbnb2': 'Airbnb',
    'vrbo': 'VRBO',
    'homeaway': 'VRBO',
    'homeaway2': 'VRBO',
    'booking': 'Booking.com',
    'bookingcom': 'Booking.com',
    'manual': 'Direct',
  };
  return channelMap[channelId.toLowerCase()] || channelId;
}
```

---

## Technical Details

### Reservation Sync Field Addition

Current fields request:
```
_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue
```

Updated fields request:
```
_id status checkIn checkOut nightsCount guestsCount listingId source confirmationCode createdAt lastUpdatedAt money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue guest.fullName
```

### Reviews Sync - Guest Name Lookup

```typescript
// Collect reservation IDs from reviews
const reservationIds = validReviews
  .map(r => r.reservationId)
  .filter(Boolean);

// Fetch guest names from reservations table
const { data: reservations } = await supabaseClient
  .from('reservations')
  .select('id, guest_name')
  .in('id', reservationIds);

// Create lookup map
const guestNameMap = new Map(
  (reservations || []).map(r => [r.id, r.guest_name])
);

// Use in mapping
guest_name: guestNameMap.get(review.reservationId) 
            || rawReview.reviewer?.name 
            || rawReview.reviewer?.first_name 
            || null,
```

---

## Expected Outcome

After implementation:
1. **Platform column** will show formatted names like "Airbnb", "VRBO", "Booking.com" instead of blank
2. **Guest name** will be populated from reservation data for reviews that have a linked reservation
3. Future reservation syncs will capture guest names for new reviews
4. Existing reviews can be re-synced to pick up guest names

## Files to Modify

| File | Changes |
|------|---------|
| Database migration | Add `guest_name` column to reservations |
| `sync-guesty-data/index.ts` | Add `guest.fullName` field, map to `guest_name` |
| `sync-listing-reservations/index.ts` | Add `guest.fullName` field, map to `guest_name` |
| `sync-reviews/index.ts` | Fix channelId mapping, add reservation lookup for guest names |
