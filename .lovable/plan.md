
# Tighter Y-Axis Range for Rating Chart

## Overview

Update the Rating Over Time chart to use a dynamic, tighter Y-axis range that focuses on the actual data values rather than showing the full 1-5 scale.

---

## Current Behavior

The Y-axis is currently fixed from 1 to 5 with ticks at each whole number. Since most ratings cluster around 4-5 stars, the chart appears flat and doesn't show meaningful variation.

## Proposed Change

Calculate a dynamic Y-axis range based on the actual data:
- Find the minimum and maximum ratings in the dataset
- Add padding (0.5) above and below to provide visual breathing room
- Clamp the range to stay within valid rating bounds (1-5)
- Generate appropriate tick marks for the tighter range

---

## Implementation

**File**: `src/components/RatingTrendChart.tsx`

```typescript
// Calculate dynamic Y-axis range based on data
const ratings = data.map(d => d.avg_rating);
const minRating = Math.min(...ratings);
const maxRating = Math.max(...ratings);

// Add padding and clamp to valid range (1-5)
const yMin = Math.max(1, Math.floor((minRating - 0.5) * 2) / 2); // Round down to nearest 0.5
const yMax = Math.min(5, Math.ceil((maxRating + 0.5) * 2) / 2);  // Round up to nearest 0.5

// Generate tick marks at 0.5 intervals
const ticks = [];
for (let i = yMin; i <= yMax; i += 0.5) {
  ticks.push(Number(i.toFixed(1)));
}
```

The YAxis component will be updated from:
```tsx
<YAxis 
  domain={[1, 5]} 
  ticks={[1, 2, 3, 4, 5]}
  ...
/>
```

To:
```tsx
<YAxis 
  domain={[yMin, yMax]} 
  ticks={ticks}
  tickFormatter={(value) => value.toFixed(1)}
  ...
/>
```

---

## Example

If ratings range from 4.2 to 4.8:
- Current: Y-axis shows 1-5 (data appears as a flat line near the top)
- New: Y-axis shows 3.5-5.0 (data shows meaningful variation)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/RatingTrendChart.tsx` | Calculate dynamic Y-axis range and ticks based on actual data values |
