

## Add Horizontal Scroll Bar to Goals Review Table

### Overview
Replace the current `overflow-auto` div wrapper with the Radix UI `ScrollArea` component to provide a styled, visible horizontal scrollbar for the Goals Review table. This will make it easier for users to navigate the wide table with 12 monthly columns.

### Current State
- The GoalsReviewTable component (`src/components/GoalsReviewTable.tsx`) wraps the table in a div with `overflow-auto` (line 214)
- This provides basic scrolling but the scrollbar may not be clearly visible or styled
- The project already has a `ScrollArea` component from Radix UI (`src/components/ui/scroll-area.tsx`) that provides styled scrollbars

### Implementation Plan

#### Update `src/components/GoalsReviewTable.tsx`

**Add Import:**
- Import `ScrollArea, ScrollBar` from `@/components/ui/scroll-area`

**Replace Container:**
- Replace the outer `div` wrapper with `ScrollArea` component
- Add explicit `ScrollBar orientation="horizontal"` to ensure horizontal scrollbar is always visible
- Preserve the existing `max-h-[calc(100vh-300px)]` for vertical scrolling constraints

### Technical Details

**Current code (line 214):**
```typescript
<div className="border rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
  <Table>
    ...
  </Table>
</div>
```

**Updated code:**
```typescript
<ScrollArea className="border rounded-lg max-h-[calc(100vh-300px)]">
  <div className="w-max min-w-full">
    <Table>
      ...
    </Table>
  </div>
  <ScrollBar orientation="horizontal" />
</ScrollArea>
```

The `w-max min-w-full` wrapper ensures:
- The table can expand beyond the viewport width (`w-max`)
- It maintains at least full width when content is smaller (`min-w-full`)
- This triggers the horizontal scrollbar when needed

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/GoalsReviewTable.tsx` | Import ScrollArea/ScrollBar, replace div wrapper with ScrollArea component |

### User Experience
1. User navigates to Goals Review page
2. A styled horizontal scrollbar appears at the bottom of the table
3. User can smoothly scroll left/right to view all 12 monthly columns
4. Vertical scrolling continues to work as before for long lists of properties
5. Scrollbar styling matches the application's design system

