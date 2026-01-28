

# Add Gap Quality Penalty to Forecast Accuracy

## Current Problem
The March 2026 forecast of $13,050 treats all 10 available nights equally, but they're not:

| Gap | Dates | Nights | Current Treatment | Reality |
|-----|-------|--------|-------------------|---------|
| Gap 1 | Mar 6-13 | 8 nights | 100% weight each | Unlikely to get full 8-night booking |
| Gap 2 | Mar 20 | 1 night | 100% weight | Orphan night - very hard to book |
| Gap 3 | Mar 28 | 1 night | 100% weight | Orphan night - very hard to book |

### Historical Booking Patterns (102 De Leon)
- **2-night stays**: 5 bookings (28%) - most common
- **5-night stays**: 4 bookings (22%) 
- **7-night stays**: 3 bookings (17%)
- **3-4 night stays**: 2 bookings (11%)
- **8+ night stays**: 2 bookings (11%) - rare

## Solution: Add Gap Quality Analysis

### Gap Penalty Logic

**1. Orphan Nights (1-night gaps)**
Single nights surrounded by booked dates are extremely hard to fill. Apply 15-25% booking probability.

**2. Short Gaps (2-3 nights)**
Below typical minimum stay requirements. Apply 40-60% probability.

**3. Medium Gaps (4-6 nights)**
Sweet spot for this property's booking patterns. Apply 80-90% probability.

**4. Large Gaps (7+ nights)**
Unlikely to fill completely. Calculate expected fill based on historical stay length distribution.

### Implementation

```typescript
// NEW: Analyze gap structure and apply quality penalties
function analyzeGapQuality(
  availableNights: Array<{ date: string; price: number }>,
  historicalStayLengths: { nights: number; count: number }[]
): { 
  effectiveNights: number; 
  weightedRevenue: number; 
  gaps: Array<{ startDate: string; nights: number; penalty: number; reason: string }> 
} {
  
  // Group consecutive available nights into gaps
  const gaps: Array<{ dates: { date: string; price: number }[]; startDate: string }> = [];
  let currentGap: { date: string; price: number }[] = [];
  
  const sortedNights = [...availableNights].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  for (let i = 0; i < sortedNights.length; i++) {
    const night = sortedNights[i];
    const prevNight = sortedNights[i - 1];
    
    if (prevNight) {
      const dayDiff = Math.floor(
        (new Date(night.date).getTime() - new Date(prevNight.date).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (dayDiff > 1) {
        // Non-consecutive - save current gap and start new one
        if (currentGap.length > 0) {
          gaps.push({ dates: currentGap, startDate: currentGap[0].date });
        }
        currentGap = [night];
      } else {
        currentGap.push(night);
      }
    } else {
      currentGap.push(night);
    }
  }
  
  // Don't forget the last gap
  if (currentGap.length > 0) {
    gaps.push({ dates: currentGap, startDate: currentGap[0].date });
  }
  
  // Apply penalties based on gap size
  let totalEffectiveNights = 0;
  let totalWeightedRevenue = 0;
  const gapResults: Array<{ startDate: string; nights: number; penalty: number; reason: string }> = [];
  
  for (const gap of gaps) {
    const gapSize = gap.dates.length;
    const gapRevenue = gap.dates.reduce((sum, d) => sum + d.price, 0);
    
    let penalty: number;
    let reason: string;
    
    if (gapSize === 1) {
      // Orphan night - very hard to book
      penalty = 0.20;
      reason = 'Orphan night (1-night gap)';
    } else if (gapSize === 2) {
      // 2-night gap - below many min stays but this property has 2-night bookings
      penalty = 0.50;
      reason = '2-night gap (below typical min stay)';
    } else if (gapSize === 3) {
      // 3-night gap - common minimum stay
      penalty = 0.65;
      reason = '3-night gap';
    } else if (gapSize <= 5) {
      // 4-5 night gap - sweet spot based on booking patterns
      penalty = 0.85;
      reason = `${gapSize}-night gap (sweet spot)`;
    } else if (gapSize <= 7) {
      // 6-7 night gap - good size, likely to fill
      penalty = 0.80;
      reason = `${gapSize}-night gap (likely partial fill)`;
    } else {
      // 8+ night gap - unlikely to fill completely
      // Estimate: most likely to get a 4-5 night booking + maybe a 2-night
      const expectedFill = Math.min(gapSize, 5 + 2); // ~7 nights max expected
      penalty = expectedFill / gapSize;
      reason = `${gapSize}-night gap (expect ~${expectedFill} nights booked)`;
    }
    
    totalEffectiveNights += gapSize * penalty;
    totalWeightedRevenue += gapRevenue * penalty;
    
    gapResults.push({
      startDate: gap.startDate,
      nights: gapSize,
      penalty,
      reason
    });
  }
  
  return {
    effectiveNights: totalEffectiveNights,
    weightedRevenue: totalWeightedRevenue,
    gaps: gapResults
  };
}
```

### Integration with Existing Lead Time Decay

The gap quality penalty should be applied AFTER lead time decay:

```typescript
// Step 1: Apply lead time decay (existing)
const leadTimeResult = applyLeadTimeDecay(...);

// Step 2: Apply gap quality penalty (NEW)
const gapResult = analyzeGapQuality(
  leadTimeResult.details.map(d => ({ date: d.date, price: d.price })),
  historicalStayLengths
);

// Final weighted revenue = lead time weighted × gap penalty
const finalWeightedRevenue = gapResult.weightedRevenue;
const finalEffectiveNights = gapResult.effectiveNights;

// Log the gap analysis
for (const gap of gapResult.gaps) {
  console.log(
    `  → Gap ${gap.startDate}: ${gap.nights} nights × ${(gap.penalty * 100).toFixed(0)}% = ` +
    `${(gap.nights * gap.penalty).toFixed(1)} effective (${gap.reason})`
  );
}
```

## March 2026 Calculation Example

### Before (Current)
| Component | Value |
|-----------|-------|
| On Books | $8,413 |
| 10 available nights × $519 avg × 89% occ | $4,637 |
| **Forecast** | **$13,050** |

### After (With Gap Quality)
| Gap | Nights | Avg Rate | Gap Penalty | Effective Value |
|-----|--------|----------|-------------|-----------------|
| Mar 6-13 | 8 | $534 | 87.5% (expect ~7 nights) | $3,738 |
| Mar 20 | 1 | $443 | 20% (orphan) | $89 |
| Mar 28 | 1 | $427 | 20% (orphan) | $85 |
| **Total** | **10** | | | **$3,912** |

Then apply compset occupancy (89%):
- Expected Additional: $3,912 × 89% = **$3,482**
- **New Forecast: $8,413 + $3,482 = $11,895**

This is more realistic - acknowledging that the 2 orphan nights likely won't book and the 8-night gap probably won't fill completely.

## Changes Summary

| File | Changes |
|------|---------|
| `supabase/functions/forecast-revenue/index.ts` | Add `analyzeGapQuality()` function, integrate with existing lead time decay, add gap logging |

## Expected Results

| Month | Before | After | Notes |
|-------|--------|-------|-------|
| Feb 2026 | $7,962 | ~$7,500 | 2 orphan nights get penalized |
| Mar 2026 | $13,050 | ~$11,800 | 8-night gap + 2 orphans |
| Apr+ | (check) | (check) | Depends on gap structure |

## Testing Plan
1. Regenerate forecast for 102 De Leon
2. Verify March shows ~$11,800 (not $13,050)
3. Check logs show gap analysis breakdown
4. Verify orphan nights show 20% penalty
5. Verify large gaps show partial-fill expectation

