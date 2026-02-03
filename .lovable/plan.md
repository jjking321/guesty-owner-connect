

# Reorganize Settings Page: Separate Airbnb and Forecast Cards

## Overview

Move the Airbnb auto-sync toggle into its own dedicated card (the existing Airbnb Ratings card) and create a new Revenue Forecasts card with description, link to Forecast Admin, and the forecast toggle.

---

## Current State

The Airbnb and Forecast toggles are currently nested inside each Guesty account card (lines 676-702), appearing only when automation is enabled. This makes them hard to find and doesn't provide context about what these features do.

---

## Proposed Changes

### 1. Remove Toggles from Guesty Account Cards

Remove the nested toggles for Airbnb scraping and forecast generation from inside each account card (lines 676-702).

### 2. Enhance Airbnb Ratings Card

Add the auto-sync toggle to the existing Airbnb Ratings card (lines 867-924):
- Add a toggle with label "Include in nightly sync"
- Keep the manual scrape button and progress card
- Show toggle for first account (since it's org-wide)

### 3. Create New Revenue Forecasts Card

Add a new card after Airbnb Ratings with:
- **Title**: "Revenue Forecasts" with TrendingUp icon
- **Description**: Explains what forecasts do based on the RevPAR velocity model
- **Auto-sync toggle**: "Include in nightly sync"
- **Link to Forecast Admin**: Button to navigate to `/forecast-admin` for manual runs and first-time setup
- **Info text**: Brief explanation of the model

---

## Technical Changes

### File: `src/pages/Settings.tsx`

**1. Add Link import:**
```typescript
import { Link } from "react-router-dom";
```

**2. Remove nested toggles from account cards (lines 676-702):**
Delete the conditional block that shows Airbnb and Forecast toggles when automation is enabled.

**3. Update Airbnb Ratings Card (around line 867):**
Add the toggle to the card header area.

**4. Add new Revenue Forecasts Card after Airbnb Ratings Card:**
```tsx
{/* Revenue Forecasts */}
{firstAccountId && (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Revenue Forecasts
          </CardTitle>
          <CardDescription>
            Automatically predict future revenue using the RevPAR velocity model
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="forecast-auto-sync"
            checked={guestyAccounts[0]?.forecast_generation_enabled !== false}
            onCheckedChange={(checked) => handleToggleForecastGeneration(guestyAccounts[0].id, checked)}
          />
          <Label htmlFor="forecast-auto-sync" className="text-sm cursor-pointer">
            Include in nightly sync
          </Label>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          Forecasts compare your current booking pace against last year's performance 
          to predict monthly revenue with P10-P50-P90 confidence ranges.
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Baseline:</strong> Last year's actual monthly revenue</li>
          <li><strong>Velocity:</strong> Current bookings vs. same day last year</li>
          <li><strong>Projection:</strong> Baseline x Velocity (0.5x to 2.0x range)</li>
        </ul>
      </div>
      
      <div className="flex items-center gap-4">
        <Button variant="outline" asChild>
          <Link to="/forecast-admin">
            <RefreshCw className="mr-2 h-4 w-4" />
            Forecast Admin
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Run manual forecasts or first-time data preparation
        </p>
      </div>
    </CardContent>
  </Card>
)}
```

---

## UI Layout (After Changes)

```
Settings Page
├── Guesty Accounts Card
│   └── [Account cards with sync buttons - no feature toggles]
│
├── Airbnb Ratings Card
│   ├── Title + Toggle: "Include in nightly sync"
│   ├── Last scraped info
│   ├── Manual scrape button
│   └── Progress card
│
├── Revenue Forecasts Card (NEW)
│   ├── Title + Toggle: "Include in nightly sync"
│   ├── Description of RevPAR velocity model
│   └── Link to Forecast Admin page
│
├── Team Management
└── AI Prompts Settings
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Settings.tsx` | Add Link import, remove nested toggles from account cards, add toggle to Airbnb card, add new Forecasts card with toggle and link |

