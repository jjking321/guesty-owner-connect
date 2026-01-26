
## Goals Review Page

A new page for bulk reviewing and editing property revenue goals in a table format, showing monthly goals alongside historical actuals and compset averages.

---

### Page Layout

```text
+------------------------------------------------------------------+
| Goals Review                           [Year: 2026 ▾]            |
+------------------------------------------------------------------+
| Summary: Total Goals: $XXX,XXX | Last Year: $XXX,XXX | +X.X%    |
+------------------------------------------------------------------+
| Search: [_____________]   [Export CSV] [Lock Selected] [Unlock]  |
+------------------------------------------------------------------+
| TABLE                                                            |
| Property | Jan Goal | Jan LY | Jan Comp | Feb Goal | ... | Total |
|----------|----------|--------|----------|----------|-----|-------|
| [x] P1   | $3,500   | $2,951 | $2,730   | $6,000   | ... | $54K  |
| [x] P2   | $4,000   | $3,200 | $3,100   | $5,500   | ... | $48K  |
+------------------------------------------------------------------+
```

---

### Key Features

**Table Columns:**
- Property name with checkbox for bulk selection
- 12 month columns, each showing:
  - Goal (editable input, colored if locked)
  - Last Year Actual (from reservation_nights for year-1)
  - Compset Average (from property_compset_summary monthly_averages)
- Row totals for Goals, Last Year, and Compset

**Bulk Actions:**
- Lock All Goals (for selected properties)
- Unlock All Goals (for selected properties)
- Export CSV with all data

**Inline Editing:**
- Click on any unlocked goal cell to edit
- Save button per row or auto-save on blur
- Visual indicator for locked months (green lock icon)

---

### Technical Implementation

| File | Action | Description |
|------|--------|-------------|
| `src/pages/GoalsReview.tsx` | Create | New page component with table layout |
| `src/components/GoalsReviewTable.tsx` | Create | Table component with inline editing |
| `src/App.tsx` | Edit | Add route `/goals-review` |
| `src/components/AppSidebar.tsx` | Edit | Add navigation item for Goals Review |

---

### Data Fetching

**Goals Query:**
```typescript
// Fetch all property_goals for selected year
supabase.from('property_goals')
  .select('*')
  .eq('year', selectedYear)
```

**Historical Actuals Query:**
```typescript
// Aggregate reservation_nights by listing and month for year-1
supabase.from('reservation_nights')
  .select('listing_id, night_date, revenue_allocation')
  .gte('night_date', `${year-1}-01-01`)
  .lte('night_date', `${year-1}-12-31`)
// Then group by month in JavaScript
```

**Compset Averages Query:**
```typescript
// Fetch monthly_averages from property_compset_summary
supabase.from('property_compset_summary')
  .select('listing_id, monthly_averages')
```

---

### Table Structure

Each row represents a property with these columns:
1. **Checkbox** - for bulk selection
2. **Property** - name and thumbnail
3. **Jan through Dec** - each month shows goal (editable), with hover showing LY actual and compset
4. **Total** - sum of 12 months
5. **Lock** - button to lock/unlock all months for that property
6. **Actions** - save button

**Alternative compact view:** Show just goals with expandable rows to see LY and compset details.

---

### Inline Editing Logic

```typescript
// Track edited goals in state
const [editedGoals, setEditedGoals] = useState<Map<string, number>>()

// On blur or Enter, save the individual goal
const saveGoal = async (listingId: string, month: number, value: number) => {
  await supabase.from('property_goals')
    .upsert({
      listing_id: listingId,
      year: selectedYear,
      month: month,
      projection_revenue: value
    }, { onConflict: 'listing_id,year,month' })
}
```

---

### Bulk Lock/Unlock

```typescript
// Lock all goals for selected properties
const bulkLock = async (listingIds: string[], lock: boolean) => {
  const { data: session } = await supabase.auth.getSession()
  await supabase.from('property_goals')
    .update({ 
      locked: lock,
      locked_at: lock ? new Date().toISOString() : null,
      locked_by: lock ? session?.session?.user?.id : null
    })
    .eq('year', selectedYear)
    .in('listing_id', listingIds)
}
```

---

### Visual Design

- **Locked cells:** Gray background with green lock icon
- **Unlocked cells:** White/transparent with input field
- **Last Year column:** Muted text color, right-aligned
- **Compset column:** Blue accent, right-aligned
- **Difference indicators:** Green for goal > LY, red for goal < LY
- **Sticky columns:** Property name sticks on horizontal scroll
- **Sticky header:** Month headers stick on vertical scroll
