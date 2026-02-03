
# Clean Up Guesty Accounts Card to Match Other Settings Cards

## Overview

Restructure the Guesty Accounts card to follow the same visual pattern as the Airbnb Ratings, Booking Probabilities, and Revenue Forecasts cards - with a clean header containing icon + title/description on the left and the primary action button on the right.

---

## Current Issues

1. **Inconsistent header style** - No icon in title, "Add Account" button in header
2. **Dense nested cards** - Each account is wrapped in its own Card, making it visually heavy
3. **Sync status info** - Very dense vertical list of sync timestamps
4. **Auto Sync toggle placement** - Inline with delete button, awkward layout

---

## Proposed Changes

### 1. Update Card Header

Add the Key icon (already imported) to match other cards:

```tsx
<CardHeader>
  <div className="flex items-center justify-between">
    <div>
      <CardTitle className="flex items-center gap-2">
        <Key className="h-5 w-5 text-primary" />
        Guesty Accounts
      </CardTitle>
      <CardDescription>
        Connect and manage your Guesty API accounts
      </CardDescription>
    </div>
    <Button onClick={() => setShowAddForm(!showAddForm)}>
      <Plus className="mr-2 h-4 w-4" />
      Add Account
    </Button>
  </div>
</CardHeader>
```

### 2. Simplify Account List Items

Replace nested `<Card>` with simpler dividers:

- Use `border-b` dividers between accounts instead of nested cards
- Keep the same information but in a cleaner layout
- Place Auto Sync toggle more prominently at the top right of each account
- Keep delete button but move to a cleaner position

### 3. Updated Account Item Structure

```tsx
<div className="py-4 border-b last:border-b-0">
  <div className="flex items-start justify-between mb-3">
    <div className="space-y-1">
      <p className="font-semibold">{account.account_name}</p>
      {/* Compact sync info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {account.last_listings_sync && (
          <span className="flex items-center gap-1">
            <Home className="h-3 w-3" />
            Listings: {formatDate(account.last_listings_sync)}
            {count && ` (${count})`}
          </span>
        )}
        {/* ... other sync times ... */}
      </div>
    </div>
    <div className="flex items-center gap-3">
      {/* Auto Sync toggle */}
      <div className="flex items-center gap-2">
        <Switch ... />
        <Label>Auto Sync</Label>
        {enabled && <Badge>3 AM UTC</Badge>}
      </div>
      {/* Delete button */}
      <AlertDialog>...</AlertDialog>
    </div>
  </div>
  
  {/* Sync buttons row */}
  <div className="flex gap-2">
    {/* Sync buttons */}
  </div>
</div>
```

### 4. Move Add Form

Keep the add form inside CardContent but style it as a collapsible section rather than a nested card with heavy border.

---

## Visual Comparison

### Before:
```
┌─────────────────────────────────────────────────┐
│ Guesty Accounts                    [Add Account]│
│ Connect and manage...                           │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │ Beachside VR     [Switch] Auto [3AM] [🗑] │  │
│  │ Listings: 2/2...                          │  │
│  │ Reservations: 2/2...                      │  │
│  │ Owners: 2/2...                            │  │
│  │ Reviews: 2/2...                           │  │
│  │ Calendars: 1/26...                        │  │
│  │ Last Auto Sync: 2/2...                    │  │
│  │ [Sync Listings] [Sync Res...] [...]       │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### After:
```
┌─────────────────────────────────────────────────┐
│ 🔑 Guesty Accounts                 [Add Account]│
│ Connect and manage your Guesty API accounts     │
├─────────────────────────────────────────────────┤
│ Beachside VR           [Switch] Auto Sync [3AM] │
│ 🏠 2/2 5:02 (465) 📅 2/2 5:50 (27554) ... [🗑]  │
│                                                 │
│ [Sync Listings] [Sync Reservations] [...]       │
│ ─────────────────────────────────────────────── │
│ (next account if any...)                        │
└─────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/Settings.tsx` | Restructure Guesty card header and account list layout |

---

## Detailed Code Changes

### 1. CardHeader (lines ~537-548)

Update to match other cards with icon in title:

```tsx
<CardHeader>
  <div className="flex items-center justify-between">
    <div>
      <CardTitle className="flex items-center gap-2">
        <Key className="h-5 w-5 text-primary" />
        Guesty Accounts
      </CardTitle>
      <CardDescription>
        Connect and manage your Guesty API accounts
      </CardDescription>
    </div>
    <Button onClick={() => setShowAddForm(!showAddForm)}>
      <Plus className="mr-2 h-4 w-4" />
      Add Account
    </Button>
  </div>
</CardHeader>
```

### 2. Account List (lines ~613-862)

- Remove nested `<Card>` wrapper for each account
- Use simpler `<div className="py-4 border-b last:border-b-0">` 
- Restructure the sync info to be more horizontal/compact
- Keep delete button aligned with Auto Sync toggle in the top right

### 3. Add Form Styling (lines ~552-599)

Change from heavy `border-2 border-primary` nested card to a simpler collapsible section with subtle background.
