
# Move Delete Button Next to Account Name

## Overview

Move the delete button from the right-side action area to be positioned directly next to the account name for easier access and cleaner visual grouping.

---

## Current Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Beachside VR                    [Auto Sync Toggle] [3AM] [🗑]│
│ 🏠 2/2  📅 2/2  👥 2/2  ⭐ 2/2  📆 2/2  🕐 Auto: 2/2         │
└──────────────────────────────────────────────────────────────┘
```

## New Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Beachside VR [🗑]               [Auto Sync Toggle] [3AM]     │
│ 🏠 2/2  📅 2/2  👥 2/2  ⭐ 2/2  📆 2/2  🕐 Auto: 2/2         │
└──────────────────────────────────────────────────────────────┘
```

---

## Changes

### File: `src/pages/Settings.tsx`

**1. Move AlertDialog from actions area to account name area (lines 620-621)**

Change the account name section from:
```tsx
<p className="font-semibold">{account.account_name}</p>
```

To:
```tsx
<div className="flex items-center gap-2">
  <p className="font-semibold">{account.account_name}</p>
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <!-- Same dialog content as before -->
    </AlertDialogContent>
  </AlertDialog>
</div>
```

**2. Remove AlertDialog from the actions area (lines 694-715)**

Remove the entire AlertDialog block from the right-side actions div, keeping only the Auto Sync toggle and badge.

---

## Visual Result

The delete button will be a smaller, subtle trash icon directly after the account name, making it clear which account would be deleted while keeping the Auto Sync controls cleanly grouped on the right.
