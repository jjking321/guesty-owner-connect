

## Add Chart View Toggle for Monthly Pacing Breakdown

### Overview
Add a toggle to the Monthly Pacing Breakdown section in the PacingReport component that allows users to switch between the existing table view and a new line chart visualization. This will provide a more visual way to analyze monthly pacing data trends.

### Current State
- The PacingReport component (`src/components/PacingReport.tsx`) displays a "Monthly Breakdown" collapsible table when in "monthly" mode
- The table shows 12 months of data with Revenue, Nights, Occupancy, and RevPAR metrics
- Each metric includes current year values and year-over-year percentage changes
- The project uses Recharts library for charts (LineChart, ResponsiveContainer, etc.)

### Implementation Plan

#### 1. Update `src/components/PacingReport.tsx`

**Add View State:**
- Add a new state variable to toggle between table and chart views: `const [viewMode, setViewMode] = useState<'table' | 'chart'>('table')`

**Add Toggle Group:**
- Add a small toggle next to the "Monthly Breakdown" label with two options: "Table" and "Chart"
- Use the existing `ToggleGroup` component from `@/components/ui/toggle-group`

**Add Chart Visualization:**
- Create a multi-line chart showing all four metrics (Revenue, Nights, Occupancy, RevPAR) for the current vs last year
- Use LineChart from Recharts with:
  - X-axis: Month names
  - Y-axis: Dual axis (left for Revenue/RevPAR in $, right for Occupancy/Nights in %)
  - Lines for current year vs last year values
  - Different colors for each metric pair
  - Interactive tooltip showing values on hover
  - Legend to identify the lines

**Chart Design:**
- Revenue: Blue solid line (current) and blue dashed line (last year)
- Nights: Green solid line (current) and green dashed line (last year)
- Occupancy: Purple solid line (current) and purple dashed line (last year)
- RevPAR: Orange solid line (current) and orange dashed line (last year)
- Include checkboxes to show/hide individual metric pairs for cleaner visualization

### Technical Details

**Imports to add:**
```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
```

**View toggle UI:**
```typescript
<ToggleGroup
  type="single"
  value={viewMode}
  onValueChange={(value) => value && setViewMode(value as 'table' | 'chart')}
  size="sm"
>
  <ToggleGroupItem value="table" className="text-xs px-2">
    <TableIcon className="h-3 w-3 mr-1" />
    Table
  </ToggleGroupItem>
  <ToggleGroupItem value="chart" className="text-xs px-2">
    <LineChartIcon className="h-3 w-3 mr-1" />
    Chart
  </ToggleGroupItem>
</ToggleGroup>
```

**Chart data structure:**
The existing `monthlyData` useMemo already computes all required data. The chart will consume:
- `month` - X-axis label
- `currentRevenue` / `lastRevenue` - Revenue lines
- `currentNights` / `lastNights` - Nights lines
- `currentOccupancy` / `lastOccupancy` - Occupancy lines
- `currentRevPAR` / `lastRevPAR` - RevPAR lines

**Dual Y-Axis approach:**
- Left Y-axis for Revenue (in dollars)
- Right Y-axis for Occupancy (as percentage)
- Include metric filter checkboxes to show 1-2 metrics at a time for clarity

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/PacingReport.tsx` | Add view toggle state, toggle UI, chart rendering, metric visibility checkboxes |

### User Experience
1. User navigates to Group Detail page and clicks the "Pacing" tab
2. User selects "Monthly" period type to reveal the Monthly Breakdown section
3. User expands the Monthly Breakdown collapsible
4. By default, the table view is shown (preserving existing behavior)
5. User can click "Chart" toggle to switch to the line chart visualization
6. Chart shows trend lines for current year vs last year
7. User can toggle individual metrics on/off via checkboxes for cleaner comparison
8. Toggling back to "Table" shows the original table view

