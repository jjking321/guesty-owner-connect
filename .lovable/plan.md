

## Fix Same Store Filter in PacingReport Component

### Problem Identified
The `PacingReport` component receives a `listingIds` prop to filter which properties should be included in metrics, but the calculation functions (`calculateBookedRevenue`, `calculateOwnerNights`, and `monthlyData`) iterate over ALL reservations without checking if each reservation's `listing_id` is in the `effectiveListingIds` array.

**Current behavior:**
- Revenue/Nights are calculated from ALL reservations (ignoring the filter)
- Occupancy/RevPAR denominators use the filtered property count
- This causes a mismatch when "Same Store Only" is checked

### Solution
Filter reservations to only include those belonging to `effectiveListingIds` before using them in calculations.

### Implementation Plan

#### Update `src/components/PacingReport.tsx`

**1. Create Filtered Reservations:**
Add a `useMemo` early in the component to pre-filter reservations by listing IDs:

```typescript
// Filter reservations to only include those for the effective listing IDs
const filteredReservations = useMemo(() => {
  if (effectiveListingIds.length === 0) return reservations;
  const listingIdSet = new Set(effectiveListingIds);
  return reservations.filter(r => r.listing_id && listingIdSet.has(r.listing_id));
}, [reservations, effectiveListingIds]);
```

**2. Update All Calculation Calls:**
Replace `reservations` with `filteredReservations` in:

- `calculatePacingMetrics()` function:
  - Line 288: `calculateBookedRevenue(..., filteredReservations, ...)`
  - Line 295: `calculateBookedRevenue(..., filteredReservations, ...)`
  - Line 330: `calculateOwnerNights(..., filteredReservations, ...)`
  - Line 331: `calculateOwnerNights(..., filteredReservations, ...)`

- `monthlyData` useMemo (lines 411-412):
  - `calculateBookedRevenue(periodStart, periodEnd, filteredReservations, currentCutoff)`
  - `calculateBookedRevenue(lastYearPeriodStart, lastYearPeriodEnd, filteredReservations, lastYearCutoff)`

**3. Update useMemo Dependencies:**
Update the `monthlyData` dependency array to include `filteredReservations` instead of `reservations`.

### Technical Details

**Why a Set for filtering:**
Using a `Set` for `listingIdSet` provides O(1) lookup time when filtering reservations, which is more efficient than checking `.includes()` on an array for large datasets.

**Placement of the filter:**
The filtered reservations memo should be placed right after the `effectiveListingIds` declaration (around line 74) so it's available for all subsequent calculations.

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/PacingReport.tsx` | Add filtered reservations memo; update all calculation function calls to use filtered data |

### Expected Behavior After Fix
1. User navigates to Portfolio Overview > Pacing tab
2. User checks "Same Store Only" checkbox
3. All metrics (Revenue, Nights, Occupancy, RevPAR) update to only reflect properties with data in both years
4. Revenue values decrease appropriately when new properties are excluded
5. YoY comparisons become accurate "apples-to-apples" comparisons

