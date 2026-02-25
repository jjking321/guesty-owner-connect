

# Make Guest Name a Guesty Link + Add Refresh Button

## File: `src/components/TaxExemptTable.tsx`

### 1. Add imports
- Add `useQueryClient` from `@tanstack/react-query`
- Add `RefreshCw` from `lucide-react`
- Add `toast` from `sonner`

### 2. Add state and refresh handler
- Add `const queryClient = useQueryClient()`
- Add `const [refreshingId, setRefreshingId] = useState<string | null>(null)`
- Add a `refreshReservation` function that:
  - Sets `refreshingId` to the reservation's id
  - Calls `sync-listing-reservations` edge function with the reservation's `listing_id`
  - Invalidates the `tax-exempt-reservations` query on success
  - Shows a toast for success/error
  - Clears `refreshingId`

### 3. Update `renderRow` — Guest Name cell (line 81)
Change from plain text to a clickable link:
```tsx
<TableCell className="text-sm">
  <a
    href={`https://app.guesty.com/reservations/${r.id}/summary`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-blue-600 hover:underline"
  >
    {r.guest_name || "—"}
  </a>
</TableCell>
```

### 4. Update `renderRow` — Add refresh button next to hide/show (line 86-96)
Add a second icon button before the existing hide/show button:
```tsx
<TableCell className="text-center">
  <div className="flex items-center justify-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={refreshingId === r.id}
      onClick={() => refreshReservation(r.id, r.listing_id)}
      title="Refresh from Guesty"
    >
      {refreshingId === r.id ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
    </Button>
    <Button variant="ghost" size="icon" className="h-7 w-7" ...>
      {/* existing hide/show */}
    </Button>
  </div>
</TableCell>
```

### 5. Update header column width (line 156)
Widen the actions column from `w-[60px]` to `w-[90px]` to fit both buttons.

No database or backend changes needed. The `sync-listing-reservations` edge function already exists.

