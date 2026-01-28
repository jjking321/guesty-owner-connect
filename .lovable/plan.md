

## Fix Property-Level Reservation Sync

### Issues Identified

1. **Wrong API Parameter**: The `sync-listing-reservations` edge function passes `listingId` (singular) to the Guesty API, but Guesty's `/v1/reservations` endpoint expects `listingIds` (plural, as a comma-separated string or using filters). This causes the function to fetch ALL account reservations instead of just the specific property.

2. **Missing Reservation**: The Amy Park reservation `6972bb9c3e299b003290def0` isn't in the database because either:
   - It was created after the last sync (14:52 UTC today)
   - Or the API returned all reservations but this one has an unusual status

### Implementation Plan

#### Update `supabase/functions/sync-listing-reservations/index.ts`

**Fix the Guesty API parameter:**

Change line 383-388 from:
```typescript
const result = await fetchGuestyData(apiToken, 'reservations', {
  limit,
  skip,
  listingId: listingId,
  fields: '...',
});
```

To:
```typescript
const result = await fetchGuestyData(apiToken, 'reservations', {
  limit,
  skip,
  listingIds: listingId,  // Changed from listingId to listingIds
  fields: '...',
});
```

According to Guesty API documentation, the reservations endpoint accepts `listingIds` (plural) as a comma-separated string of listing IDs to filter by.

### Technical Details

| Current Behavior | Expected Behavior |
|-----------------|-------------------|
| Fetches 1460 reservations (entire account) | Should fetch ~37 reservations (single property) |
| Parameter `listingId` is ignored by Guesty API | Parameter `listingIds` will filter correctly |

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-listing-reservations/index.ts` | Change API parameter from `listingId` to `listingIds` |

### After Implementation

1. Re-run the property-level sync for 102 Deleon
2. Should see ~37 reservations synced (not 1460)
3. If Amy Park reservation still missing, check in Guesty dashboard that it exists and verify its status

### About the Missing Reservation

Once the fix is deployed, running the sync again should fetch only the correct property's reservations. If the Amy Park reservation (Jan 23-26) still doesn't appear:
- Verify it exists in Guesty with status `confirmed`, `checked_in`, or `checked_out`
- Check if the reservation was created very recently (after 14:52 UTC today)
- The reservation might have a different status like `pending` that isn't being returned

