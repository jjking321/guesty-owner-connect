

# Add "Other Subtotal" Summary Box

## Change

Add a fourth summary card to the top of the tax report that shows the subtotal for rows where `provider === "other"` only.

## File: `src/components/TaxReportGenerator.tsx`

1. **Compute the new metric** (after the existing totals around line 218):
   ```typescript
   const otherSubtotal = reportRows
     .filter((r) => r.provider === "other")
     .reduce((acc, r) => acc + (r.totalPayout || 0), 0);
   ```

2. **Add a fourth card** to the summary grid (around line 225), changing the grid from `grid-cols-3` to `grid-cols-4`:
   ```html
   <div className="rounded-lg border bg-card p-4">
     <p className="text-sm text-muted-foreground">Other Subtotal</p>
     <p className="text-2xl font-bold">{fmtNum(otherSubtotal)}</p>
   </div>
   ```

No database or backend changes needed.

