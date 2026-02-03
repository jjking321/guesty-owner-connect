

# Fix Actionables Detection & Add Revenue-Focused Features

## Overview

Fix the detection logic bugs and shift focus to revenue-impacting actionables like pricing misalignment and unbookable gaps.

---

## Issues Found

| Issue | Root Cause | Impact |
|-------|------------|--------|
| "Missing Goals" false positives | Checks `goal > 0` instead of record existence | ~771 false alerts |
| Rating 0 flagged as critical | No check to exclude `rating = 0` (no reviews) | ~5-10 false alerts |
| Pricing comparison not implemented | Compset data fetched but never used | Missing revenue opportunities |
| Low priority on revenue issues | Unbookable gaps scored same as ratings | Poor prioritization |

---

## Fixes

### 1. Missing Goals Logic (Line 478)

**Current (broken):**
```typescript
const monthsWithGoals = new Set(goals.filter(g => g.goal > 0).map(g => g.month));
```

**Fixed:**
```typescript
// Check if goal RECORD exists, regardless of value
// A $0 goal is intentional - user set it, so not "missing"
const monthsWithGoals = new Set(goals.map(g => g.month));
```

### 2. Rating 0 Filter (Line 379)

**Current (broken):**
```typescript
if (listing.live_airbnb_rating !== null) {
  if (listing.live_airbnb_rating < 4.3) {
```

**Fixed:**
```typescript
// Exclude rating 0 (no reviews yet) - not a problem, just new listing
if (listing.live_airbnb_rating !== null && listing.live_airbnb_rating > 0) {
  if (listing.live_airbnb_rating < 4.3) {
```

### 3. Add Pricing vs Compset Detection

Compare property calendar rates against compset `monthly_averages` ADR:

```typescript
// Get compset data for this listing
const compsetData = compsetByListing.get(listing.id);
const calendar = calendarByListing.get(listing.id) || [];

if (compsetData && Array.isArray(compsetData) && compsetData.length > 0 && calendar.length > 0) {
  // Group calendar prices by month (YYYY-MM format)
  const pricesByMonth: Record<string, { prices: number[]; dates: string[] }> = {};
  
  for (const day of calendar) {
    if (day.price && day.price > 0) {
      const month = day.date.substring(0, 7); // "2026-02"
      if (!pricesByMonth[month]) pricesByMonth[month] = { prices: [], dates: [] };
      pricesByMonth[month].prices.push(day.price);
      pricesByMonth[month].dates.push(day.date);
    }
  }
  
  // Compare each month against compset ADR
  for (const [month, data] of Object.entries(pricesByMonth)) {
    const yourAvgRate = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
    
    // Find matching compset month (format: "2026-02")
    const compsetMonth = compsetData.find((m: any) => m.month === month);
    
    if (compsetMonth?.adr && compsetMonth.adr > 0) {
      const priceDiff = (yourAvgRate - compsetMonth.adr) / compsetMonth.adr;
      
      if (priceDiff > 0.20) {
        // Overpriced by 20%+ - may be losing bookings
        issues.push({
          category: 'pricing_high',
          priority: 'high',
          score: 0,
          title: `${month} rates ${Math.round(priceDiff * 100)}% above market`,
          description: `Your avg $${yourAvgRate.toFixed(0)}/night vs compset $${compsetMonth.adr.toFixed(0)}. ${data.prices.length} available nights may be overpriced.`,
          revenue_impact: data.prices.length * yourAvgRate * 0.3, // Assume 30% booking loss
          affected_dates: data.dates.slice(0, 5),
          data_snapshot: { 
            your_rate: yourAvgRate, 
            compset_adr: compsetMonth.adr, 
            diff_pct: Math.round(priceDiff * 100),
            nights: data.prices.length 
          },
        });
      } else if (priceDiff < -0.25) {
        // Underpriced by 25%+ - leaving money on table
        const missedRevenue = data.prices.length * (compsetMonth.adr - yourAvgRate);
        issues.push({
          category: 'pricing_low',
          priority: 'high',
          score: 0,
          title: `${month} rates ${Math.abs(Math.round(priceDiff * 100))}% below market`,
          description: `Your avg $${yourAvgRate.toFixed(0)}/night vs compset $${compsetMonth.adr.toFixed(0)}. Potential +$${missedRevenue.toFixed(0)} opportunity.`,
          revenue_impact: missedRevenue,
          affected_dates: data.dates.slice(0, 5),
          data_snapshot: { 
            your_rate: yourAvgRate, 
            compset_adr: compsetMonth.adr, 
            diff_pct: Math.round(priceDiff * 100),
            nights: data.prices.length,
            missed_revenue: missedRevenue
          },
        });
      }
    }
  }
}
```

### 4. Update Priority Scoring (Revenue Focus)

**Updated Category Scores:**
```typescript
const CATEGORY_SCORES: Record<string, number> = {
  'unbookable_gap': 35,      // Was 30 - direct revenue loss, easily fixable
  'pricing_high': 28,        // Was 18 - losing bookings = revenue loss
  'low_probability': 25,     // Was 20 - revenue at risk  
  'pricing_low': 22,         // Was 15 - leaving money on table
  'forecast_miss': 20,       // Keep same
  'low_rating': 20,          // Was 25 - less immediately actionable
  'yoy_pacing_gap': 15,      // Keep same
  'recent_low_review': 12,   // Was 15 - informational
  'high_demand_available': 12, // Keep same
  'missing_goals': 5,        // Was 10 - lowest priority (administrative)
};
```

---

## Data Flow Changes

Need to update the compset query to fetch both `future_monthly_averages` AND `monthly_averages` (historical data that includes current months):

```typescript
// In the parallel fetch
supabase
  .from('property_compset_summary')
  .select('listing_id, future_monthly_averages, monthly_averages'),
```

Use `monthly_averages` for comparison since it has actual ADR data (the query showed populated data with ADR values like $314, $293, etc.).

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/generate-actionables/index.ts` | Fix missing goals, skip rating 0, add pricing comparison, update scores |

---

## Expected Outcome

**Before (Current):**
- ~771 "missing_goals" issues (false positives from $0 goals)
- ~5-10 "low_rating" issues at rating 0
- 0 pricing comparison issues
- Revenue issues not prioritized

**After:**
- Near-zero false positive "missing_goals" (only truly missing records)
- No false rating alerts for new listings
- New "pricing_high" and "pricing_low" issues where compset data exists
- Revenue-impacting issues ranked at top

---

## Technical Notes

- Compset `monthly_averages` uses format `"2026-02"` for month keys
- Calendar dates are `"2026-02-03"` format, so we substring to compare
- Pricing thresholds: >20% above (overpriced), >25% below (underpriced)
- Existing booking probability and forecast logic is correct, just no matching data currently

