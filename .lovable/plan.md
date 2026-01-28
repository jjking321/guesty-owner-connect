

## Fix Property-Level Reservation Sync (Correct Approach)

### Root Cause
The Guesty API does not accept `listingIds` as a direct query parameter. Instead, it requires using the `filters` parameter with a JSON array of filter objects. The previous fix was incorrect.

### Correct API Syntax
From Guesty documentation:
```
filters=[{"operator": "$eq", "field": "listingId", "value": "1234"}]
```

### Implementation Plan

#### Update `supabase/functions/sync-listing-reservations/index.ts`

**1. Create the filters JSON before the pagination loop (around line 378):**

Add:
```typescript
// Create filter to only fetch reservations for this specific listing
const filters = JSON.stringify([
  {
    field: 'listingId',
    operator: '$eq',
    value: listingId,
  }
]);
```

**2. Update the fetchGuestyData call (lines 383-388):**

Change from:
```typescript
const result = await fetchGuestyData(apiToken, 'reservations', {
  limit,
  skip,
  listingIds: listingId,
  fields: '...',
});
```

To:
```typescript
const result = await fetchGuestyData(apiToken, 'reservations', {
  limit,
  skip,
  filters,  // Use proper filters parameter
  fields: '...',
});
```

### Technical Details

| Item | Value |
|------|-------|
| Current (broken) | `listingIds: listingId` - ignored by Guesty API |
| Correct approach | `filters: JSON.stringify([{field:'listingId',operator:'$eq',value:listingId}])` |
| Evidence | `sync-new-reservations` uses same pattern successfully for date filtering |

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-listing-reservations/index.ts` | Add filters variable, replace `listingIds` with `filters` in API call |

### After Implementation

1. Re-deploy the edge function
2. Re-run the property-level sync for 102 Deleon
3. Should see ~37 reservations synced (not 1463)
4. Amy Park reservation should appear if it exists in Guesty

