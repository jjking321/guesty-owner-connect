

## Add "Same Store" Checkbox to Portfolio Pacing Tab

### Overview
Add a "Same Store" checkbox filter to the Pacing tab that filters the portfolio to only show properties (listings) that have reservation data for both the current year and the previous year. This allows for a fair "apples-to-apples" comparison of pacing metrics by excluding new properties that weren't active last year.

### Current State
- The Pacing tab in `PropertiesBulkEdit.tsx` (lines 1256-1270) displays `PacingReport` with all `listingIds`
- The `allReservations` array contains all confirmed/checked-in/checked-out reservations
- `PacingReport` accepts a `listingIds` prop to filter which properties are included in the metrics

### Implementation Plan

#### Update `src/pages/PropertiesBulkEdit.tsx`

**1. Add State for Same Store Filter:**
Add a new state variable to track the checkbox state:
```typescript
const [sameStoreOnly, setSameStoreOnly] = useState(false);
```

**2. Calculate Same Store Listing IDs:**
Create a `useMemo` that identifies listings with reservations in both the current year and the previous year:
```typescript
const sameStoreListingIds = useMemo(() => {
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  
  // Group reservations by listing and check which years they have data for
  const listingYears = new Map<string, Set<number>>();
  
  for (const r of allReservations) {
    if (!r.check_in || !r.listing_id) continue;
    const checkInYear = new Date(r.check_in).getFullYear();
    
    // Consider reservations in current year or last year
    if (checkInYear === currentYear || checkInYear === lastYear) {
      if (!listingYears.has(r.listing_id)) {
        listingYears.set(r.listing_id, new Set());
      }
      listingYears.get(r.listing_id)!.add(checkInYear);
    }
  }
  
  // Return listings that have data for BOTH years
  const result: string[] = [];
  for (const [listingId, years] of listingYears) {
    if (years.has(currentYear) && years.has(lastYear)) {
      result.push(listingId);
    }
  }
  
  return result;
}, [allReservations]);
```

**3. Determine Effective Listing IDs:**
Create a derived value that uses either all listings or same-store listings based on the checkbox:
```typescript
const effectivePacingListingIds = sameStoreOnly ? sameStoreListingIds : listingIds;
```

**4. Add Checkbox UI in Pacing Tab:**
Add a checkbox control above or alongside the PacingReport component:
```typescript
<TabsContent value="pacing" className="space-y-4">
  <div className="flex items-center gap-4">
    <div className="flex items-center gap-2">
      <Checkbox
        id="same-store"
        checked={sameStoreOnly}
        onCheckedChange={(checked) => setSameStoreOnly(!!checked)}
      />
      <Label htmlFor="same-store" className="text-sm font-medium cursor-pointer">
        Same Store Only
      </Label>
    </div>
    {sameStoreOnly && (
      <span className="text-xs text-muted-foreground">
        Showing {sameStoreListingIds.length} of {listingIds.length} properties 
        with data in both {currentYear - 1} and {currentYear}
      </span>
    )}
  </div>
  
  {allReservations.length > 0 ? (
    <PacingReport 
      reservations={allReservations} 
      listingIds={effectivePacingListingIds} 
    />
  ) : (
    <Card>...</Card>
  )}
</TabsContent>
```

**5. Import Label Component:**
Add the Label import if not already present:
```typescript
import { Label } from "@/components/ui/label";
```

### Technical Details

**Same Store Logic:**
- A "same store" listing is one that has at least one reservation with `check_in` in the current year AND at least one reservation with `check_in` in the previous year
- This mirrors standard retail "same store sales" comparisons
- The filter applies to the `listingIds` prop, so the `PacingReport` component will only calculate metrics for these filtered properties

**UI Behavior:**
- Default: checkbox unchecked (show all properties)
- When checked: only properties with data in both years are included
- Shows a count of how many properties qualify as "same store"
- The PacingReport will automatically recalculate all metrics based on the filtered listing IDs

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/PropertiesBulkEdit.tsx` | Add state, useMemo for same store logic, checkbox UI, and pass filtered listingIds to PacingReport |

### User Experience
1. User navigates to Portfolio Overview and clicks the "Pacing" tab
2. A "Same Store Only" checkbox appears above the pacing report
3. When checked, the report filters to only show properties active in both years
4. A helper text shows how many properties qualify (e.g., "Showing 42 of 58 properties with data in both 2025 and 2026")
5. All pacing metrics (revenue, nights, occupancy, RevPAR) update to reflect only the filtered properties
6. This enables accurate year-over-year comparisons by excluding new properties

