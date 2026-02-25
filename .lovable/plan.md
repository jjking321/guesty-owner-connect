

# Switch Backfill from Check-In to Check-Out Month

The backfill tool currently filters by `check_in` date, but the tax report filters by `check_out` date. This mismatch means backfilled subtotals don't appear in the report. The fix is straightforward: change all date filtering in the edge function from `check_in` to `check_out`.

## Changes

### 1. Edge Function: `supabase/functions/backfill-reservation-subtotals/index.ts`

**Parameter rename** (line 215): Parse `checkOutMonths` from the request body (with fallback to `checkInMonths` for backward compatibility).

**Validation message** (line 223-227): Update error message to reference `checkOutMonths`.

**Date filter comments** (line 244-246): Update comments from "checkInMonths" to "checkOutMonths".

**Main query** (lines 262-270): Change `.select('id, check_in')` to `.select('id, check_out')`, and change `.gte('check_in', ...)` / `.lte('check_in', ...)` to `.gte('check_out', ...)` / `.lte('check_out', ...)`.

**Month filter** (lines 274-280): Filter on `r.check_out.substring(0, 7)` instead of `r.check_in`.

**Total count query** (lines 302-309): Same `check_in` → `check_out` swap.

**Remaining count query** (lines 406-413): Same `check_in` → `check_out` swap.

**Self-invoke body** (line 426): Send `checkOutMonths` instead of `checkInMonths`.

**Log message** (line 258): Update log from "check-in months" to "check-out months".

### 2. UI Component: `src/components/BackfillSubtotals.tsx`

**Request body** (line 65): Change `checkInMonths` to `checkOutMonths`.

**Description text** (line 88): Change "check-in months" to "check-out months".

### Files to edit
- `supabase/functions/backfill-reservation-subtotals/index.ts` (8 changes, all `check_in` → `check_out`)
- `src/components/BackfillSubtotals.tsx` (2 label/param changes)

