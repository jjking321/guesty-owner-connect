

# Plan: Nightly Automated Dispute Analysis for Recent Reviews

## Overview

Set up a nightly cron job that automatically processes dispute reviews, but only for reviews received in the past 7 days to avoid processing old backlog.

## Changes Required

### 1. Update Edge Function: `supabase/functions/batch-analyze-disputes/index.ts`

Add a `maxAgeDays` parameter to filter reviews by date:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxAgeDays` | number | 7 | Only process reviews from the past X days |

**Code Changes:**

```typescript
// Line 22 - Add maxAgeDays to destructuring
const { limit = 10, skipWithoutReservation = false, maxAgeDays = 7 } = await req.json().catch(() => ({}));

// After line 36 - Add date filter before limit
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

let query = supabase
  .from('reviews')
  .select('id, guest_name, reservation_id, listing_id, review_date')
  .eq('dispute_status', 'triage')
  .gte('review_date', cutoffDate.toISOString())  // Only recent reviews
  .order('review_date', { ascending: false })
  .limit(limit);
```

**Updated logging:**
```typescript
console.log(`Starting batch dispute analysis. Limit: ${limit}, maxAgeDays: ${maxAgeDays}`);
```

### 2. Create Cron Job via SQL

Set up a nightly cron job using `pg_cron` and `pg_net` extensions:

```sql
-- Schedule nightly at 2:00 AM UTC
SELECT cron.schedule(
  'nightly-dispute-analysis',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/batch-analyze-disputes',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"limit": 50, "maxAgeDays": 7, "skipWithoutReservation": true}'::jsonb
  ) AS request_id;
  $$
);
```

**Cron Configuration:**
- **Schedule**: `0 2 * * *` (2:00 AM UTC daily)
- **Limit**: 50 reviews per run (safe batch size)
- **maxAgeDays**: 7 (only reviews from past week)
- **skipWithoutReservation**: true (can't analyze without conversation)

## Processing Flow

```text
┌────────────────────────────────────────────────────────────────────┐
│                    Nightly Cron (2:00 AM UTC)                      │
│                              ↓                                     │
│    batch-analyze-disputes with:                                    │
│    • limit: 50                                                     │
│    • maxAgeDays: 7 (only past week)                               │
│    • skipWithoutReservation: true                                  │
│                              ↓                                     │
│    For each qualifying review:                                     │
│    1. Fetch conversation from Guesty                               │
│    2. Analyze red flags with AI                                    │
│    3. Run final dispute analysis                                   │
│    4. Move to 'submit_claim' or 'not_eligible'                    │
└────────────────────────────────────────────────────────────────────┘
```

## Safety Measures

| Concern | Mitigation |
|---------|------------|
| Processing old reviews | `maxAgeDays: 7` filter ensures only recent reviews |
| Rate limits | 2-second delays between reviews, 1-second between API calls |
| AI credit exhaustion | Function stops gracefully on 402 error |
| Guesty rate limits | Skip and continue on 429, with 5-second backoff |
| Edge function timeout | 50 review limit keeps within 60-second timeout |

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/batch-analyze-disputes/index.ts` | Add `maxAgeDays` parameter and date filtering |

## SQL to Execute (via Run SQL)

The cron job will be created using the Supabase SQL insert tool with the service role key.

## What Happens Moving Forward

1. **New negative review comes in** → Automatically gets `dispute_status: 'triage'`
2. **Nightly at 2 AM UTC** → Cron job triggers batch analysis
3. **Reviews from past 7 days in triage** → Processed automatically
4. **Outcome** → Each review moves to `submit_claim` or `not_eligible`

