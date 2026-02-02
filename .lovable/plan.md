
# Add Airbnb Listing ID to Listings

## Overview

Add support for extracting and storing the Airbnb listing ID from the Guesty API. The ID is located in the `integrations.airbnb2.externalId` field of each listing.

## Implementation Steps

### Step 1: Database Migration

Add a new nullable column `airbnb_listing_id` to the `listings` table:

```sql
ALTER TABLE listings 
ADD COLUMN airbnb_listing_id TEXT;
```

### Step 2: Update GuestyListing Interface

Add the `integrations` field to the interface:

```typescript
interface GuestyListing {
  _id: string;
  createdAt: string;
  nickname: string;
  status: string;
  isListed: boolean;
  active: boolean;
  propertyType: string;
  accommodates: number;
  bedrooms: number;
  address: any;
  picture?: { thumbnail?: string; _id?: string; original?: string; };
  pictures?: Array<{ thumbnail?: string; _id?: string; original?: string; }>;
  integrations?: {
    airbnb2?: {
      externalId?: string;
    };
  };
}
```

### Step 3: Update API Fields Request

Add `integrations` to the fields being fetched:

| Before | After |
|--------|-------|
| `_id createdAt nickname status isListed active propertyType accommodates bedrooms address picture pictures` | `_id createdAt nickname status isListed active propertyType accommodates bedrooms address picture pictures integrations` |

### Step 4: Update Upsert Logic

Extract the Airbnb ID and include it in the upsert:

```typescript
const listingsToUpsert = guestyListings.map((listing: GuestyListing) => {
  // ... existing thumbnail extraction ...
  
  // Extract Airbnb listing ID from integrations
  const airbnbListingId = listing.integrations?.airbnb2?.externalId || null;
  
  return {
    id: listing._id,
    guesty_account_id: accountId,
    // ... existing fields ...
    airbnb_listing_id: airbnbListingId,
    updated_at: new Date().toISOString(),
  };
});
```

## Files to Modify

| File | Changes |
|------|---------|
| Database migration | Add `airbnb_listing_id` column to `listings` table |
| `supabase/functions/sync-guesty-data/index.ts` | Update interface, API fields, and upsert logic |

## Expected Result

After syncing listings, each listing will have its Airbnb ID populated (if integrated with Airbnb) in the `airbnb_listing_id` column. This can be used for:
- Deep linking to Airbnb listings
- Cross-referencing with Airbnb data sources
- Display in property details

## Technical Notes

- The `integrations` field may contain other channel data (VRBO, Booking.com, etc.) but we're specifically targeting `airbnb2.externalId`
- Not all listings will have an Airbnb integration, so the field is nullable
- The field is a simple TEXT type to handle various ID formats
