
# Add Booking Probability Auto-Calculation to Nightly Sync

## Overview

Add automated booking probability calculations to the nightly sync process. Since revenue forecasts **depend on** booking probabilities for their probability-weighted expected value calculations, probabilities must run **before** forecasts in the sync sequence.

---

## Current State

| Aspect | Status |
|--------|--------|
| Storage | `booking_probabilities` table with 25+ columns |
| Current records | Only 1,810 records across ~6 listings (manual runs) |
| UI Usage | ListingCalendar probability overlay, CalendarDateDetail, RateSimulator |
| Backend Usage | `forecast-revenue` uses probabilities for expected value calculations |
| Automation | **None** - only manual per-listing via UI button |

---

## Why This Matters

Booking probabilities feed directly into revenue forecasts:
- The forecast engine reads from `booking_probabilities` table
- Uses probability scores to weight available nights' expected revenue
- Without fresh probabilities, forecasts use stale or missing data

Running probabilities nightly ensures forecasts always have current data.

---

## Execution Order (Updated)

```text
1. Per Account Loop:
   - Sync Listings
   - Sync New Reservations  
   - Sync Owners
   - Sync Calendar

2. After All Accounts:
   - Scrape Airbnb Ratings (~11 min)
   - Calculate All Probabilities (~15-20 min) <-- NEW
   - Regenerate Forecasts (~25 min)
```

Probabilities MUST run before forecasts to ensure fresh data.

---

## Technical Changes

### 1. Database Migration

Add `probability_calculation_enabled` column to `guesty_accounts`:

```sql
ALTER TABLE public.guesty_accounts 
ADD COLUMN IF NOT EXISTS probability_calculation_enabled boolean DEFAULT true;
```

### 2. Create New Edge Function: `calculate-all-probabilities`

**File:** `supabase/functions/calculate-all-probabilities/index.ts`

Follows the same pattern as `generate-all-forecasts`:
- Query all active listings (`is_listed = true`, `archived = false`)
- Create progress tracking record in `forecast_generation_progress` (reuse same table with different status type)
- Process in batches of 10 listings
- Use `EdgeRuntime.waitUntil()` for background processing
- Return immediately with progress ID

**Key logic:**
```typescript
// Process each listing
for (const listing of batch) {
  await supabase.functions.invoke('calculate-booking-probabilities', {
    body: { listingId: listing.id }
  });
}
```

### 3. Update `nightly-sync/index.ts`

Add polling function for probability completion (similar to forecasts):

```typescript
async function waitForProbabilityCompletion(
  supabase: any,
  progressId: string,
  timeoutMs: number = 1200000 // 20 minute default
): Promise<SyncResult> {
  // Same polling logic as waitForForecastCompletion
}
```

Add probability calculation step **before** forecast generation:

```typescript
// 6. Calculate All Booking Probabilities
const probabilityEnabled = accounts.some(a => a.probability_calculation_enabled !== false);
let probabilityResult: SyncResult | null = null;

if (probabilityEnabled) {
  console.log(`\n--- Calculating Booking Probabilities ---`);
  const { data: probResponse, error: probInvokeError } = await supabase.functions.invoke(
    'calculate-all-probabilities',
    { headers: { 'x-service-role': 'true' } }
  );

  if (probInvokeError) {
    probabilityResult = { success: false, error: probInvokeError.message };
  } else if (probResponse?.progress_id) {
    probabilityResult = await waitForProbabilityCompletion(
      supabase,
      probResponse.progress_id,
      1200000 // 20 minutes
    );
  }
} else {
  probabilityResult = { success: true, skipped: true };
}

// 7. Regenerate All Forecasts (existing code)
// ... forecasts now run with fresh probability data
```

### 4. Update `src/pages/Settings.tsx`

Add toggle for probability calculation in the Guesty account or a new card:

Option A: Add to existing Guesty account card (like the other toggles)
Option B: Create a new "Booking Probability" card with description

**Recommended: Option B** - Create new card with explanation since probabilities are a distinct feature with their own logic (compset demand, price position, historical data, booking window scoring).

```tsx
{/* Booking Probabilities */}
{firstAccountId && (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Booking Probabilities
          </CardTitle>
          <CardDescription>
            AI-calculated likelihood of booking each available night
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={guestyAccounts[0]?.probability_calculation_enabled !== false}
            onCheckedChange={(checked) => handleToggleProbabilityCalculation(guestyAccounts[0].id, checked)}
          />
          <Label className="text-sm cursor-pointer">
            Include in nightly sync
          </Label>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          Probabilities combine four signals to estimate booking likelihood for each open night:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Compset Demand:</strong> How many comparables are already booked</li>
          <li><strong>Price Position:</strong> Your rate vs. available compset average</li>
          <li><strong>Historical:</strong> Was this date booked last year?</li>
          <li><strong>Booking Window:</strong> Days until arrival vs. typical lead time</li>
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        View probabilities on any property's calendar tab
      </p>
    </CardContent>
  </Card>
)}
```

### 5. Add config.toml entry

```toml
[functions.calculate-all-probabilities]
verify_jwt = false
```

---

## Time Estimates

| Step | Listings | Time Estimate | Timeout |
|------|----------|---------------|---------|
| Existing steps | - | ~25 min | - |
| **Probabilities** | **471** | **~15-20 min** | **20 min** |
| Forecasts | 471 × 2 | ~25 min | 30 min |

**Total nightly sync: ~60-70 minutes**

---

## Response Updates

Add probability result to nightly sync response:

```typescript
return new Response(
  JSON.stringify({
    success: true,
    // ...existing fields...
    airbnbRatingsScrape: airbnbScrapeResult,
    probabilityCalculation: probabilityResult,  // NEW
    forecastGeneration: forecastResult,
  }),
  ...
);
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/calculate-all-probabilities/index.ts` | **Create** - bulk probability calculation |
| `supabase/functions/nightly-sync/index.ts` | Modify - add probability step before forecasts |
| `src/pages/Settings.tsx` | Modify - add new Booking Probabilities card with toggle |
| `supabase/config.toml` | Modify - add new function config |
| Database migration | Add `probability_calculation_enabled` column |

---

## Handler Function for Settings

Add new handler in Settings.tsx:

```typescript
const handleToggleProbabilityCalculation = async (accountId: string, enabled: boolean) => {
  try {
    const { error } = await supabase
      .from('guesty_accounts')
      .update({ probability_calculation_enabled: enabled })
      .eq('id', accountId);
    
    if (error) throw error;
    
    toast({
      title: enabled ? "Probability calculation enabled" : "Probability calculation disabled",
      description: `Nightly sync will ${enabled ? 'include' : 'skip'} booking probability updates`,
    });
    
    refetchAccounts();
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message,
      variant: "destructive",
    });
  }
};
```
