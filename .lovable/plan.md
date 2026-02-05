
# Plan: Add "Last Synced" Indicator to Reviews Page

## Overview
Add a "Last synced" text indicator below the page title showing when reviews were last synchronized, matching the pattern used on other pages like the ListingCalendar component.

## Current State
- The Reviews page header shows "Reviews Management" title and description
- No indication of when reviews were last synced
- The `sync_jobs` table tracks completed sync operations with timestamps

## Implementation

### 1. Add Query for Last Sync Time

Add a new useQuery hook to fetch the most recent completed sync job for either `reviews` or `new_reviews` types:

```typescript
const { data: lastSyncTime } = useQuery({
  queryKey: ['reviews', 'lastSync', guestyAccountId],
  queryFn: async () => {
    if (!guestyAccountId) return null;
    
    const { data, error } = await supabase
      .from('sync_jobs')
      .select('completed_at')
      .eq('guesty_account_id', guestyAccountId)
      .in('sync_type', ['reviews', 'new_reviews'])
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error || !data) return null;
    return new Date(data.completed_at).toLocaleString();
  },
  enabled: !!guestyAccountId,
});
```

### 2. Update Header Description

Update the description text below the title to include the last sync time:

**Before:**
```tsx
<p className="text-muted-foreground">View and manage reviews across all properties</p>
```

**After:**
```tsx
<p className="text-muted-foreground">
  View and manage reviews across all properties
  {lastSyncTime && (
    <span className="ml-2 text-xs">• Last synced: {lastSyncTime}</span>
  )}
</p>
```

### 3. Invalidate on Sync Complete

The existing `SyncProgressCard` already calls `queryClient.invalidateQueries({ queryKey: ['reviews'] })` on completion, which will refresh the last sync time automatically.

## Visual Result
The header will display:
```
Reviews Management
View and manage reviews across all properties • Last synced: 2/5/2026, 9:14:17 PM
```

## Files Modified
| File | Change |
|------|--------|
| `src/pages/Reviews.tsx` | Add lastSyncTime query and display in header description |
