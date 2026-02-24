

# Fix Tax Exempt Table: Only Show Manual Reservations

## Problem
Platform reservations (Airbnb, VRBO, etc.) appear in the Tax Exempt tab because their `tax_amount` is NULL -- the sync hasn't populated tax data for them yet. These aren't truly tax-exempt; they just haven't had their tax amounts synced.

## Fix
Add a `.eq("source", "manual")` filter to the query in `TaxExemptTable.tsx` so only manually-entered reservations with $0 or NULL tax are shown. These are the genuinely tax-exempt bookings that need separate reporting.

## Technical Details

### File: `src/components/TaxExemptTable.tsx`

Add one line to the query (line 41-42):

```typescript
// Before
.in("status", ["confirmed", "checked_in", "checked_out"])
.or("tax_amount.is.null,tax_amount.eq.0");

// After
.in("status", ["confirmed", "checked_in", "checked_out"])
.eq("source", "manual")
.or("tax_amount.is.null,tax_amount.eq.0");
```

No other files need changes.
