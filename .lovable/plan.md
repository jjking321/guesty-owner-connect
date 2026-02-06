

# Plan: Add Last Updated Timestamps to Settings Page

## Overview

Add "last updated" timestamps with listing counts to the Booking Probabilities and Revenue Forecasts cards on the Settings page, similar to how the Airbnb Ratings card already shows this information.

## Current State

| Feature | Has Timestamp? | Data Source |
|---------|---------------|-------------|
| Airbnb Ratings | Yes | `sync_jobs` table or `listings.live_rating_scraped_at` |
| Booking Probabilities | No | `booking_probabilities.calculated_at` available |
| Revenue Forecasts | No | `revenue_forecasts.generated_at` available |

## Implementation

### 1. Add State Variables

```typescript
const [lastProbabilityCalc, setLastProbabilityCalc] = useState<{ date: string; count: number } | null>(null);
const [lastForecastGeneration, setLastForecastGeneration] = useState<{ date: string; count: number } | null>(null);
```

### 2. Add Load Functions

Query the database for the most recent calculation/generation timestamp:

```typescript
const loadLastProbabilityCalc = async () => {
  const { data } = await supabase
    .from("booking_probabilities")
    .select("calculated_at, listing_id")
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (data?.calculated_at) {
    // Get distinct listing count for recent calculations
    const { count } = await supabase
      .from("booking_probabilities")
      .select("listing_id", { count: 'exact', head: true })
      .gte("calculated_at", new Date(Date.now() - 24*60*60*1000).toISOString());
    
    setLastProbabilityCalc({
      date: data.calculated_at,
      count: count || 0
    });
  }
};

const loadLastForecastGeneration = async () => {
  const { data } = await supabase
    .from("revenue_forecasts")
    .select("generated_at, listing_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (data?.generated_at) {
    // Get distinct listing count for this generation batch
    const { count } = await supabase
      .from("revenue_forecasts")
      .select("listing_id", { count: 'exact', head: true })
      .gte("generated_at", new Date(Date.now() - 24*60*60*1000).toISOString());
    
    setLastForecastGeneration({
      date: data.generated_at,
      count: count || 0
    });
  }
};
```

### 3. Call in useEffect

```typescript
useEffect(() => {
  loadAccounts();
  loadLastAirbnbScrape();
  loadLastProbabilityCalc();
  loadLastForecastGeneration();
}, []);
```

### 4. Update Booking Probabilities Card UI

Add the timestamp display between the header and the description list:

```tsx
<CardContent className="space-y-4">
  {/* New timestamp display */}
  <div className="text-sm text-muted-foreground">
    {lastProbabilityCalc ? (
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Last calculated: {new Date(lastProbabilityCalc.date).toLocaleString()}
        {lastProbabilityCalc.count > 0 && ` (${lastProbabilityCalc.count} listings)`}
      </span>
    ) : (
      <span>Never calculated</span>
    )}
  </div>
  
  {/* Existing description content */}
  ...
</CardContent>
```

### 5. Update Revenue Forecasts Card UI

Add the timestamp display in the same location:

```tsx
<CardContent className="space-y-4">
  {/* New timestamp display */}
  <div className="text-sm text-muted-foreground">
    {lastForecastGeneration ? (
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Last generated: {new Date(lastForecastGeneration.date).toLocaleString()}
        {lastForecastGeneration.count > 0 && ` (${lastForecastGeneration.count} listings)`}
      </span>
    ) : (
      <span>Never generated</span>
    )}
  </div>
  
  {/* Existing description content */}
  ...
</CardContent>
```

## File Changes

| File | Change |
|------|--------|
| `src/pages/Settings.tsx` | Add state variables, load functions, and UI elements |

## Visual Consistency

The new timestamps will match the existing Airbnb Ratings card pattern:
- Same text size (`text-sm text-muted-foreground`)
- Same position (at top of CardContent)
- Same format (date + count in parentheses)
- Uses the Clock icon for visual consistency

