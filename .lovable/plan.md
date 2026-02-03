

# Add Forecast Regeneration to Nightly Sync

## Overview

Integrate the `generate-all-forecasts` function into the nightly sync orchestrator to automatically regenerate revenue forecasts after all data syncs complete. This ensures forecasts are always up-to-date with the latest reservation and calendar data.

---

## Current State

The `generate-all-forecasts` function:
- Generates forecasts for current year and next year for all active listings
- Uses batch processing (10 listings at a time)
- Tracks progress via `forecast_generation_progress` table
- Uses `EdgeRuntime.waitUntil()` for background processing
- Returns immediately with a progress ID

---

## Integration Approach

Since forecasts use their own progress tracking table (`forecast_generation_progress`) rather than `sync_jobs`, we need a custom polling function for forecast completion.

---

## Technical Changes

### 1. Modify `nightly-sync/index.ts`

Add a new polling function for forecast progress:

```typescript
async function waitForForecastCompletion(
  supabase: any,
  progressId: string,
  timeoutMs: number = 1800000 // 30 minute default
): Promise<SyncResult> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds (forecasts are slower)

  console.log(`[forecasts] Waiting for completion (timeout: ${timeoutMs / 1000}s)...`);

  while (Date.now() - startTime < timeoutMs) {
    const { data: progress, error } = await supabase
      .from('forecast_generation_progress')
      .select('status, completed_forecasts, failed_forecasts, total_forecasts')
      .eq('id', progressId)
      .single();

    if (error) {
      console.error(`[forecasts] Error polling progress:`, error);
      await sleep(pollInterval);
      continue;
    }

    if (progress?.status === 'completed') {
      console.log(`[forecasts] Completed: ${progress.completed_forecasts} success, ${progress.failed_forecasts} failed`);
      return { success: true };
    }

    if (progress?.status === 'failed') {
      return { success: false, error: 'Forecast generation failed' };
    }

    console.log(`[forecasts] Progress: ${progress?.completed_forecasts || 0}/${progress?.total_forecasts || 0}`);
    await sleep(pollInterval);
  }

  return { success: false, error: 'Forecast generation timed out' };
}
```

Add forecast generation step after Airbnb scraping:

```typescript
// 6. Regenerate All Forecasts (runs once for entire org)
console.log(`\n--- Regenerating Forecasts ---`);
let forecastResult: SyncResult | null = null;

const { data: forecastResponse, error: forecastInvokeError } = await supabase.functions.invoke(
  'generate-all-forecasts',
  {
    body: {},
    headers: { 'x-service-role': 'true' }
  }
);

if (forecastInvokeError) {
  console.error('Failed to invoke forecast generation:', forecastInvokeError);
  forecastResult = { success: false, error: forecastInvokeError.message };
} else if (forecastResponse?.progress_id) {
  // Poll for completion with 30 min timeout
  forecastResult = await waitForForecastCompletion(
    supabase,
    forecastResponse.progress_id,
    1800000 // 30 minutes
  );
}
```

### 2. Modify `generate-all-forecasts/index.ts`

Add service-role authentication support:

```typescript
// Check for service-role bypass (for automated nightly sync)
const isServiceRole = req.headers.get("x-service-role") === "true";

let userId: string | undefined;

if (!isServiceRole) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const { data: userData } = await supabase.auth.getUser(token || '');
  userId = userData?.user?.id;
}
// For service-role, userId remains undefined but that's fine for automated runs
```

Update the listings query to match the pattern used elsewhere:

```typescript
const { data: listings, error: listingsError } = await supabase
  .from('listings')
  .select('id, nickname')
  .eq('is_listed', true)  // Match pattern from other sync functions
  .eq('archived', false);
```

---

## Execution Order (Final)

The nightly sync will now run:

1. **Per Account Loop:**
   - Sync Listings
   - Sync New Reservations  
   - Sync Owners
   - Sync Calendar

2. **After All Accounts:**
   - Scrape Airbnb Ratings (~11 min)
   - **Regenerate Forecasts (~20-25 min for 471 listings × 2 years)**

---

## Timeout Considerations

| Step | Listings | Time Estimate | Timeout |
|------|----------|---------------|---------|
| Listings | 471 | ~30s | 10 min |
| Reservations | ~500 new | ~2 min | 10 min |
| Owners | ~50 | ~10s | 10s fixed |
| Calendar | 471 | ~8 min | 15 min |
| Airbnb Ratings | 471 | ~11 min | 20 min |
| **Forecasts** | **471 × 2 years** | **~25 min** | **30 min** |

Total estimated nightly sync time: ~45-50 minutes

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-all-forecasts/index.ts` | Add service-role auth support, update listings filter |
| `supabase/functions/nightly-sync/index.ts` | Add `waitForForecastCompletion` function and forecast generation step |

---

## Response Updates

Add forecast result to the nightly sync response:

```typescript
return new Response(
  JSON.stringify({
    success: true,
    message: `Nightly sync completed for ${successfulAccounts} account(s)`,
    duration: `${duration}s`,
    successfulAccounts,
    failedAccounts,
    results,
    airbnbRatingsScrape: airbnbScrapeResult,
    forecastGeneration: forecastResult,  // NEW
  }),
  ...
);
```

