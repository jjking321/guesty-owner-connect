

## Add Year Comp Total and Goal Variance Highlighting

### Changes Required

**File: `src/components/GoalsReviewTable.tsx`**

---

### 1. Add Comp Total to Totals Column Header (lines 220-226)

Update the Totals header to include a third sub-column for Comp:

```typescript
<TableHead className="text-center min-w-[180px]">
  <div className="text-xs font-medium">Totals</div>
  <div className="flex text-[10px] text-muted-foreground mt-1">
    <span className="flex-1">Goal</span>
    <span className="flex-1">LY</span>
    <span className="flex-1">Comp</span>
  </div>
</TableHead>
```

---

### 2. Display Comp Total in Row (lines 305-317)

Update the totals cell to display the `compTotal` (already calculated but not shown):

```typescript
<TableCell className="p-1">
  <div className="flex gap-1 text-xs">
    <div className={cn(
      "flex-1 flex items-center justify-center h-7 font-semibold",
      /* existing and new color logic */
    )}>
      {formatCurrency(goalTotal)}
    </div>
    <div className="flex-1 flex items-center justify-center h-7 text-muted-foreground font-medium">
      {formatCurrency(lyTotal)}
    </div>
    <div className="flex-1 flex items-center justify-center h-7 text-blue-600 font-medium">
      {formatCurrency(compTotal)}
    </div>
  </div>
</TableCell>
```

---

### 3. Add Goal Variance Color Logic

Create a helper function to determine if a goal is more than 5% off from either benchmark:

```typescript
const getGoalVarianceColor = (goal: number, ly: number, comp: number) => {
  // Check variance against LY (if LY exists)
  const lyVariance = ly > 0 ? Math.abs((goal - ly) / ly) : 0;
  // Check variance against Comp (if Comp exists)  
  const compVariance = comp > 0 ? Math.abs((goal - comp) / comp) : 0;
  
  // If more than 5% off from either benchmark
  if (lyVariance > 0.05 || compVariance > 0.05) {
    // Determine direction: below benchmarks = amber, above = green
    const avgBenchmark = (ly + comp) / (ly > 0 && comp > 0 ? 2 : 1);
    if (goal < avgBenchmark * 0.95) {
      return "text-amber-600"; // Goal is notably below benchmarks
    }
    return "text-green-600"; // Goal is notably above benchmarks
  }
  return ""; // Within 5% of benchmarks
};
```

Apply this color logic to:
- **Year Total Goal** cell (the total column)
- **Monthly Goal inputs** (optional enhancement for individual month visibility)

---

### Summary

| Change | Location |
|--------|----------|
| Add "Comp" sub-header to Totals column | Line 220-226 |
| Display `compTotal` value in row | Line 305-317 |
| Add `getGoalVarianceColor` helper function | New function after line 189 |
| Apply variance color to Goal total | Line 307-312 |

---

### Visual Result

The Totals column will now show:

```text
┌───────────────────────────────────┐
│            Totals                 │
│   Goal    │    LY    │   Comp    │
├───────────┼──────────┼───────────┤
│  $125.2k  │  $118.5k │  $122.0k  │  (Goal in green - above benchmarks)
│  $98.5k   │  $115.2k │  $110.8k  │  (Goal in amber - below benchmarks)
│  $112.0k  │  $110.5k │  $113.2k  │  (Goal in default - within 5%)
└───────────┴──────────┴───────────┘
```

