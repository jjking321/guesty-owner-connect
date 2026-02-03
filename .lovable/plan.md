
# Actionables Page - Property-Based Priority Dashboard

## Overview

Create a new `/actionables` page that analyzes all properties and groups issues by property, ordering properties by total issue severity. Revenue managers will see "Look into Beachside Villa - 5 issues need attention" with the most problematic properties at the top.

---

## Issue Categories (Final List)

### Core Issues (Your Original 4)
| Category | Detection Logic | Priority Weight |
|----------|-----------------|-----------------|
| **Unbookable Gaps** | Available gaps where `min_nights > gap_length` | Critical (30 pts) |
| **Low Airbnb Rating** | `live_airbnb_rating < 4.3` = critical, `< 4.5` = warning | Critical/High (25-30 pts) |
| **Low Booking Probability** | Dates with `probability < 0.3` in next 30 days | High (20 pts) |
| **Forecast vs Goals Gap** | Monthly forecast P50 < 80% of goal | High (20 pts) |

### Additional Issues
| Category | Detection Logic | Priority Weight |
|----------|-----------------|-----------------|
| **Pricing Misalignment** | Your rate 10%+ above or 15%+ below compset avg | High (18 pts) |
| **Recent Low Reviews** | Reviews from last 30 days with rating < 4 | Medium (15 pts) |
| **YoY Pacing Gap** | Current YTD revenue >15% behind same time last year | Medium (15 pts) |
| **High Demand Available** | Compset >60% booked but your date is open | Medium (12 pts) |
| **Missing Goals** | Property has no goals set for upcoming months | Low (10 pts) |

---

## Property-Based Grouping

Instead of a flat list of issues, the page groups by property and ranks properties by aggregate score:

```
Property Score = SUM(issue_priority_scores) * (1 + 0.1 * issue_count)
```

This means a property with 5 medium issues ranks higher than a property with 1 high issue.

### Example Display

```
┌─────────────────────────────────────────────────────────────────────┐
│  Actionables              [Refresh] [Filter by Category] [Filters] │
│  Properties needing your attention, ranked by urgency              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SUMMARY                                                            │
│  [12 Properties] [47 Total Issues] [18 Critical] [Last Run: 2h ago]│
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Beachside Villa                              Score: 142         │
│     ┌──────────────────────────────────────────────────────────┐   │
│     │ [CRITICAL] 3 Unbookable Gaps (Jan 15-17, Feb 2-4, Feb 8) │   │
│     │ [CRITICAL] Rating Alert: 4.1 (dropped from 4.4)          │   │
│     │ [HIGH] February forecast $3,200 vs goal $5,500 (-42%)    │   │
│     │ [MEDIUM] 2 low reviews in last 30 days                   │   │
│     └──────────────────────────────────────────────────────────┘   │
│     AI Summary: "Priority: Fix min-night settings immediately.     │
│                  Rating decline linked to recent cleanliness        │
│                  complaints. Consider rate reduction for Feb."      │
│                                            [View Property] [Dismiss]│
│                                                                     │
│  2. Ocean View Suite                             Score: 85          │
│     ┌──────────────────────────────────────────────────────────┐   │
│     │ [HIGH] 8 dates with <30% booking probability             │   │
│     │ [HIGH] Priced 18% above compset average                  │   │
│     │ [MEDIUM] YoY pacing -22% behind last year                │   │
│     └──────────────────────────────────────────────────────────┘   │
│     AI Summary: "Rate reduction of ~$35/night would align with     │
│                  compset. Focus on Feb 10-18 dates specifically."   │
│                                            [View Property] [Dismiss]│
│                                                                     │
│  3. Downtown Loft                                Score: 45          │
│     ┌──────────────────────────────────────────────────────────┐   │
│     │ [MEDIUM] High market demand - Feb 14-16 available        │   │
│     │ [LOW] No goals set for March, April                      │   │
│     └──────────────────────────────────────────────────────────┘   │
│                                            [View Property] [Dismiss]│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Table: `property_actionables`

```sql
CREATE TABLE property_actionables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  
  -- Aggregated property-level data
  total_issue_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  aggregate_score INTEGER NOT NULL DEFAULT 0,
  
  -- Individual issues stored as JSONB array
  issues JSONB NOT NULL DEFAULT '[]',
  -- Structure: [{category, priority, title, description, affected_dates, revenue_impact, data_snapshot}]
  
  -- AI-generated summary for the property
  ai_summary TEXT,
  
  -- Status tracking
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID,
  
  -- Timestamps
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_property_actionables_org ON property_actionables(organization_id, aggregate_score DESC);
CREATE INDEX idx_property_actionables_listing ON property_actionables(listing_id);

ALTER TABLE property_actionables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org actionables" ON property_actionables
  FOR SELECT USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Users can update org actionables" ON property_actionables
  FOR UPDATE USING (is_organization_member(organization_id, auth.uid()));
```

---

## Edge Function: `generate-actionables`

### Detection Queries

**1. Unbookable Gaps**
```sql
WITH consecutive_available AS (
  SELECT 
    listing_id, date, min_nights, is_available,
    date - ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY date)::int AS gap_group
  FROM capacity_calendar
  WHERE date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
    AND is_available = true
)
SELECT listing_id, MIN(date) as gap_start, MAX(date) as gap_end,
       COUNT(*) as gap_length, MAX(min_nights) as min_nights_required
FROM consecutive_available
GROUP BY listing_id, gap_group
HAVING COUNT(*) < MAX(min_nights)
```

**2. Low Probability Dates**
```sql
SELECT listing_id, 
       COUNT(*) as low_prob_days,
       ARRAY_AGG(date ORDER BY date) as affected_dates,
       AVG(probability) as avg_probability,
       AVG(your_price) as avg_rate
FROM booking_probabilities
WHERE date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
  AND probability < 0.3
GROUP BY listing_id
```

**3. Forecast vs Goals**
```sql
SELECT 
  rf.listing_id,
  pg.month,
  pg.goal_revenue,
  (rf.monthly_forecasts->>(pg.month::text - 1))::jsonb->>'p50' as forecast_p50,
  ROUND(((rf.monthly_forecasts->>(pg.month::text - 1))::jsonb->>'p50')::numeric / 
        NULLIF(pg.goal_revenue, 0) * 100) as achievement_pct
FROM revenue_forecasts rf
JOIN property_goals pg ON rf.listing_id = pg.listing_id AND rf.year = pg.year
WHERE rf.year = EXTRACT(YEAR FROM CURRENT_DATE)
  AND pg.month >= EXTRACT(MONTH FROM CURRENT_DATE)
  AND pg.goal_revenue > 0
  AND ((rf.monthly_forecasts->>(pg.month::text - 1))::jsonb->>'p50')::numeric < pg.goal_revenue * 0.8
```

**4. Pricing vs Compset**
```sql
SELECT 
  cc.listing_id, cc.date, cc.price as your_rate,
  pcs.future_monthly_averages,
  -- Extract compset avg for this date's month
FROM capacity_calendar cc
JOIN property_compset_summary pcs ON cc.listing_id = pcs.listing_id
WHERE cc.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
  AND cc.is_available = true
  -- Compare cc.price to compset average for that month
```

**5. Recent Low Reviews**
```sql
SELECT listing_id, COUNT(*) as low_review_count,
       ARRAY_AGG(jsonb_build_object('rating', rating, 'date', review_date, 'text', LEFT(review_text, 100)))
FROM reviews
WHERE review_date >= CURRENT_DATE - 30
  AND rating < 4
  AND is_removed = false
GROUP BY listing_id
```

### Priority Scoring

```typescript
function calculateIssueScore(issue: Issue): number {
  let score = 0;
  
  // Category base score
  const categoryScores = {
    'unbookable_gap': 30,
    'low_rating': 25,
    'low_probability': 20,
    'forecast_miss': 20,
    'pricing_high': 18,
    'pricing_low': 15,
    'recent_low_review': 15,
    'yoy_pacing_gap': 15,
    'high_demand_available': 12,
    'missing_goals': 10,
  };
  score += categoryScores[issue.category] || 10;
  
  // Time urgency bonus (0-15 pts)
  if (issue.daysUntil <= 7) score += 15;
  else if (issue.daysUntil <= 14) score += 10;
  else if (issue.daysUntil <= 30) score += 5;
  
  // Revenue impact bonus (0-15 pts)
  if (issue.revenueImpact >= 2000) score += 15;
  else if (issue.revenueImpact >= 1000) score += 10;
  else if (issue.revenueImpact >= 500) score += 5;
  
  return score;
}

function calculatePropertyScore(issues: Issue[]): number {
  const baseScore = issues.reduce((sum, i) => sum + i.score, 0);
  const multiplier = 1 + (issues.length * 0.1); // 10% bonus per issue
  return Math.round(baseScore * multiplier);
}
```

### AI Summary Generation

For each property with issues, call Lovable AI with:

```typescript
const prompt = `You are a revenue management assistant analyzing a vacation rental property.

Property: ${property.nickname}
Current Rating: ${property.live_airbnb_rating}

Issues Found:
${issues.map(i => `- [${i.priority}] ${i.title}: ${i.description}`).join('\n')}

Generate a 2-3 sentence actionable summary prioritizing what the revenue manager should address first. Be specific with numbers and dates.`;
```

---

## Nightly Integration

Add to `nightly-sync/index.ts`:

```typescript
// 8. Generate Actionables
const actionablesEnabled = accounts.some(a => a.actionables_generation_enabled !== false);
let actionablesResult: SyncResult | null = null;

if (actionablesEnabled) {
  console.log(`\n--- Generating Actionables ---`);
  const { error } = await supabase.functions.invoke('generate-actionables', {
    body: {},
    headers: { 'x-service-role': 'true' }
  });
  actionablesResult = error ? { success: false, error: error.message } : { success: true };
}
```

Add toggle to `guesty_accounts` table:
```sql
ALTER TABLE guesty_accounts ADD COLUMN actionables_generation_enabled BOOLEAN DEFAULT true;
```

---

## Frontend Components

### 1. `src/pages/Actionables.tsx`
Main page with:
- Summary stats (property count, issue counts by priority)
- "Last generated" timestamp with refresh button
- Filter by category (unbookable, rating, probability, etc.)
- Search by property name
- Sorted list of property cards

### 2. `src/components/PropertyActionableCard.tsx`
Expandable card showing:
- Property thumbnail + name
- Aggregate score badge
- Issue count pills (3 Critical, 2 High, etc.)
- Collapsed: First 2 issues preview
- Expanded: All issues + AI summary
- Actions: View Property, Dismiss

### 3. `src/components/ActionableSummary.tsx`
Top summary bar with:
- Total properties with issues
- Issue breakdown by priority
- Last generated timestamp
- Refresh button

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/Actionables.tsx` | Create |
| `src/components/PropertyActionableCard.tsx` | Create |
| `src/components/ActionableSummary.tsx` | Create |
| `supabase/functions/generate-actionables/index.ts` | Create |
| `src/App.tsx` | Add route `/actionables` |
| `src/components/AppSidebar.tsx` | Add "Actionables" nav item (top position) |
| `supabase/functions/nightly-sync/index.ts` | Add actionables step |
| `supabase/config.toml` | Add function config |
| Database migration | Create `property_actionables` table |

---

## Settings Integration

Add to Settings page under Guesty account toggles:
- Actionables generation enabled (default: true)

Add thresholds (can be in a separate "Actionables Settings" card):
- Rating alert threshold (default: 4.3)
- Probability alert threshold (default: 0.3)
- Forecast miss threshold (default: 80%)

---

## Technical Notes

- Edge function uses Lovable AI (google/gemini-3-flash-preview) for generating property summaries
- Function processes all listings in batches to avoid timeouts
- Issues older than 7 days are automatically cleaned up if the underlying data changes
- Dismissed properties stay dismissed until new issues are detected
