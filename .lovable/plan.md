
# Fix Forecast for New Properties Using Compset Data

## Problem Summary
102 Deleon is a new property with its first booking in October 2025. When forecasting 2026:

- **No baseline data**: Only 3 months of partial actuals ($9,867)
- **No velocity comparison**: Can't compare "this year vs last year" when last year doesn't exist
- **Current baseline**: $368/month (nonsensically low)
- **Actual bookings on file**: Already $28,552 for 2026

The forecast engine calculates a tiny baseline from the limited 2025 data, resulting in unrealistic projections.

## Available Data
Your compset already has excellent historical data:
- 7 selected comparables with 18-60 months of history
- Compset TTM Revenue: ~$101,000 average
- Compset monthly averages stored in `property_compset_summary.monthly_averages`
- Rich seasonality data going back to 2022

## Solution: Compset-Based Cold Start

When a property lacks historical data, use compset monthly averages as the baseline:

```text
IF property has < 6 months of prior year data
  THEN baseline = compset monthly averages for the same month
  AND forecastFloor = compset TTM revenue * growth factor
```

### Implementation Details

**File: `supabase/functions/forecast-revenue/index.ts`**

1. **Detect "cold start" properties**
   - Count how many months of prior year data exist
   - If fewer than 6 months have baselines, flag as "cold start"

2. **Fetch compset monthly averages**
   - Already querying `property_compset_summary.future_monthly_averages`
   - Add query for `monthly_averages` (historical compset data)

3. **Build compset-derived baseline**
   - Extract the most recent 12 months of compset monthly averages
   - Use these as the monthly baseline values
   - Apply a slight discount factor (e.g., 0.85) since new properties typically underperform established comps initially

4. **Set appropriate forecast floor**
   - For cold start properties: floor = compset TTM revenue * 0.80
   - This prevents unrealistic lows while allowing for new property ramp-up

5. **Adjust velocity calculation**
   - When no prior year data exists, use baseline (velocity = 1.0)
   - Compare current bookings to compset occupancy patterns instead

### Example Calculation for 102 Deleon

| Month | Compset Avg | Adjusted Baseline (0.85x) | Current On Books |
|-------|-------------|---------------------------|------------------|
| Jan   | $7,318      | $6,220                    | $640             |
| Feb   | $10,797     | $9,178                    | $6,653           |
| Mar   | $13,912     | $11,825                   | $8,413           |
| Apr   | $10,780     | $9,163                    | $5,810           |
| ...   | ...         | ...                       | ...              |

**Projected Annual**: ~$85,000-95,000 (vs current ~$48,000)

This is much more realistic for a 3BR Cocoa Beach property with comparable ADRs in the $300-400 range.

### Changes Summary

```text
1. Add cold start detection logic (~15 lines)
2. Query property_compset_summary.monthly_averages (~5 lines)
3. Build compset-derived baseline when needed (~30 lines)
4. Adjust forecastFloor for cold start properties (~10 lines)
5. Log cold start mode for debugging (~5 lines)
```

### Alternative Approaches Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Compset baseline (recommended)** | Uses real market data, accounts for seasonality | Requires compset setup |
| Manual goal entry | Simple, user-controlled | Doesn't improve automated forecast |
| ADR * occupancy estimate | Quick calculation | Ignores seasonal patterns |

### Testing

After implementation:
1. Regenerate forecast for 102 Deleon
2. Verify baseline values reflect compset averages
3. Confirm forecast shows realistic annual projection ($80k-100k)
4. Ensure properties WITH historical data are unaffected

---

## What You'll See After This Fix

- 102 Deleon's 2026 forecast will show ~$85-95k projected revenue
- The seasonal pattern will match the local market (peak in summer, March)
- Current bookings ($28k) will be shown as healthy pacing vs compset patterns
