# Gap Quality Penalty - IMPLEMENTED ✅

## Summary
Added `analyzeGapQuality()` function to `supabase/functions/forecast-revenue/index.ts` that penalizes orphan nights and adjusts expectations for gaps unlikely to fill completely.

## Key Changes
- **New Function**: `analyzeGapQuality()` (lines ~649-758) groups consecutive available nights into gaps and applies penalties:
  - 1-night gaps (orphans): 20% weight
  - 2-night gaps: 50% weight  
  - 3-night gaps: 65% weight
  - 4-5 night gaps: 85% weight (sweet spot)
  - 6-7 night gaps: 80% weight
  - 8+ night gaps: dynamic penalty based on expected ~7-night fill

- **Integration**: Applied after lead time decay in the probability adjustment step (lines ~990-1015)

- **Logging**: Gap analysis details are logged for each month showing gap breakdown

## Expected Results
| Month | Before | After | Notes |
|-------|--------|-------|-------|
| Mar 2026 | $13,050 | ~$11,800 | 8-night gap + 2 orphans penalized |

## Testing
1. Regenerate forecast for 102 De Leon
2. Check logs for gap analysis breakdown
3. Verify March forecast is ~$11,800 (not $13,050)
