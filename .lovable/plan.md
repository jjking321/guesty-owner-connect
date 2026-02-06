# Plan: 5:30 AM Verification and Retry for Nightly Sync

## Status: ✅ COMPLETED

## What was implemented

### 1. Edge Function Updates (`supabase/functions/nightly-sync/index.ts`)
- Added `isRateLimitError()` helper to detect rate-limit related failures
- Added `handleVerification()` function for `{ verify: true }` requests
- Verification logic:
  - Finds most recent run from last 3 hours
  - If no run found → starts new sync
  - If run still running → exits (let it finish)
  - If run completed → logs success, exits
  - If run failed with rate limit → logs "not retrying", exits
  - If run failed with other error → starts retry (max 2 retries)

### 2. Database Changes
- Added `retry_count` (integer) column to track retry attempts
- Added `retry_of` (uuid) column to reference original failed run

### 3. Cron Job
- Scheduled `nightly-sync-verify` job at **5:30 AM UTC** (`30 5 * * *`)
- Calls nightly-sync with `{"verify": true}` body

## Safety Limits
- Maximum 2 retry attempts per day
- Won't retry if error contains rate-limit keywords
- Won't retry if a run is still in progress
- Won't retry if the original run completed successfully

## Expected Behavior

| Scenario at 5:30 AM | Action |
|---------------------|--------|
| Run completed successfully | Log success, do nothing |
| Run still in progress | Do nothing (let it finish) |
| Run failed (rate limit) | Log "not retrying", do nothing |
| Run failed (other error) | Start new sync attempt |
| No run found | Start new sync |
