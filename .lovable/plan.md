

## Update Portfolio Summary Cards to Respect All Filters

### Overview
Update the Portfolio Overview summary cards to reflect only the currently filtered/visible properties, rather than showing totals for all properties in the date range.

### Current Behavior
- Summary cards show metrics for ALL properties matching the date filter
- Search query, status filters, and goal filters do NOT affect the summary cards
- This can be confusing when users filter to specific properties but see portfolio-wide totals

### New Behavior
- Summary cards will update to show metrics for only the filtered properties
- Searching for "Beach" will show totals only for beach properties
- Filtering to "Behind" status will show totals only for behind properties
- Property counts will match the number of visible rows in the table

---

### Changes Required

**File: `src/pages/PropertiesBulkEdit.tsx`**

#### 1. Update Portfolio Totals Calculation (lines 524-539)

Change the source from `propertyMetrics` to `filteredProperties`:

```typescript
const portfolioTotals = useMemo(() => {
  return filteredProperties.reduce(
    (acc, property) => ({
      actualRevenue: acc.actualRevenue + property.actualRevenue,
      onTheBooksRevenue: acc.onTheBooksRevenue + property.onTheBooksRevenue,
      projectionTotal: acc.projectionTotal + property.projectionTotal,
      forecastedRevenue: acc.forecastedRevenue + property.forecastedRevenue,
    }),
    {
      actualRevenue: 0,
      onTheBooksRevenue: 0,
      projectionTotal: 0,
      forecastedRevenue: 0,
    }
  );
}, [filteredProperties]);
```

#### 2. Update PropertyMetricsSummary Props (lines 828-840)

Change the counts to use `filteredProperties`:

```typescript
<PropertyMetricsSummary
  totalActualRevenue={portfolioTotals.actualRevenue}
  totalOnTheBooks={portfolioTotals.onTheBooksRevenue}
  totalProjection={portfolioTotals.projectionTotal}
  totalForecast={portfolioTotals.forecastedRevenue}
  propertiesCount={filteredProperties.length}
  onTrackCount={filteredProperties.filter((p) => p.status === "on-track").length}
  atRiskCount={filteredProperties.filter((p) => p.status === "at-risk").length}
  behindCount={filteredProperties.filter((p) => p.status === "behind").length}
  periodLabel={periodInfo.periodLabel}
  isPastPeriod={periodInfo.isPastPeriod}
  isFuturePeriod={periodInfo.isFuturePeriod}
/>
```

---

### Summary

| Location | Change |
|----------|--------|
| `portfolioTotals` useMemo | Use `filteredProperties` instead of `propertyMetrics` |
| `PropertyMetricsSummary` props | Use `filteredProperties` for all counts |

### Result
When users apply any combination of:
- Search query
- Property status filters (active/inactive, listed/unlisted, archived)
- Performance status filters (on-track, at-risk, behind)
- Goals filters (has goals, no goals, locked, unlocked)

The summary cards will immediately update to show totals and counts for only the matching properties.

