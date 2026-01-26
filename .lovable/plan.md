

## Goals Review Page Enhancements

Two improvements to the Goals Review table for better usability and navigation.

---

### Changes Overview

| Change | Description |
|--------|-------------|
| Clickable Property Names | Property names become links that navigate to `/listings/{id}` for detailed property view |
| Wider Month Columns | Increase column widths so Goal/LY/Comp values aren't cramped |

---

### Technical Details

**File: `src/components/GoalsReviewTable.tsx`**

1. **Add Navigation Hook**
   - Import `useNavigate` from `react-router-dom`
   - Add click handler to navigate to property detail

2. **Make Property Name Clickable**
   - Change the property name from a plain `<span>` to a clickable element
   - Add hover styling (underline, cursor pointer)
   - Navigate to `/listings/${listing.id}` on click

3. **Increase Column Widths**
   - Month columns: `min-w-[140px]` → `min-w-[180px]`
   - Property column: `min-w-[200px]` → `min-w-[220px]`
   - Totals column: `min-w-[120px]` → `min-w-[140px]`

---

### Code Changes

**Property Name (lines 243-256):**
```tsx
// Before: plain text
<span className="font-medium text-sm truncate max-w-[150px]">
  {listing.nickname || listing.id}
</span>

// After: clickable link
<button
  onClick={() => navigate(`/listings/${listing.id}`)}
  className="font-medium text-sm truncate max-w-[180px] hover:underline hover:text-primary text-left"
>
  {listing.nickname || listing.id}
</button>
```

**Column Widths:**
```tsx
// Month headers (line 209)
min-w-[140px] → min-w-[180px]

// Property header (line 207)
min-w-[200px] → min-w-[220px]

// Totals header (line 218)
min-w-[120px] → min-w-[140px]
```

