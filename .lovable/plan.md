

## Add CSV Export for Monthly Pacing Breakdown Table

### Overview
Add a "Download CSV" button to the Monthly Pacing Breakdown section that exports all monthly data including current year values and year-over-year comparisons.

### Current State
- The PacingReport component displays a "Monthly Breakdown" collapsible section with a Table/Chart toggle
- The `monthlyData` useMemo (lines 375-442) already computes all the data needed for export
- The toggle group for Table/Chart is shown when the collapsible is open (lines 664-681)

### Implementation Plan

#### Update `src/components/PacingReport.tsx`

**Add Download Icon Import:**
- Import `Download` from lucide-react

**Add Export Function:**
Create a `handleExportCSV` function that:
- Builds CSV headers: Month, Revenue, Revenue LY, Revenue vs LY %, Nights, Nights LY, Nights vs LY %, Occupancy, Occupancy LY, Occupancy vs LY %, RevPAR, RevPAR LY, RevPAR vs LY %
- Maps `monthlyData` to CSV rows with properly formatted values
- Creates a Blob and triggers download with filename `pacing-breakdown-{current-date}.csv`

**Add Export Button:**
- Place a "Download CSV" button next to the Table/Chart toggle group
- Only visible when the collapsible is open (same condition as the toggle)
- Use small variant with Download icon

### Technical Details

**Export function:**
```typescript
const handleExportPacingCSV = () => {
  const headers = [
    "Month",
    "Revenue",
    "Revenue LY",
    "Revenue vs LY %",
    "Nights",
    "Nights LY", 
    "Nights vs LY %",
    "Occupancy %",
    "Occupancy LY %",
    "Occupancy vs LY %",
    "RevPAR",
    "RevPAR LY",
    "RevPAR vs LY %"
  ];

  const rows = monthlyData.map((row) => [
    row.month,
    row.currentRevenue.toFixed(2),
    row.lastRevenue.toFixed(2),
    row.revenueChange.toFixed(1),
    row.currentNights,
    row.lastNights,
    row.nightsChange.toFixed(1),
    row.currentOccupancy.toFixed(1),
    row.lastOccupancy.toFixed(1),
    row.occupancyChange.toFixed(1),
    row.currentRevPAR.toFixed(2),
    row.lastRevPAR.toFixed(2),
    row.revPARChange.toFixed(1),
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pacing-breakdown-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

**Button placement (next to toggle group):**
```typescript
{isTableOpen && (
  <div className="flex items-center gap-2">
    <Button variant="outline" size="sm" onClick={handleExportPacingCSV}>
      <Download className="h-3 w-3 mr-1" />
      Export
    </Button>
    <ToggleGroup ... />
  </div>
)}
```

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/PacingReport.tsx` | Add Download icon import, handleExportPacingCSV function, Export button next to toggle group |

### User Experience
1. User opens the Monthly Breakdown collapsible
2. An "Export" button appears alongside the Table/Chart toggle
3. Clicking Export downloads a CSV file with all 12 months of pacing data
4. File includes both current year values and last year comparisons for each metric

