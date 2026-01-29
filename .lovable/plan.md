

# Add Vertical Scroll Bar to Goals Review Table

## Current Situation
The Goals Review table already has:
- A horizontal `ScrollBar` for navigating across the 12 months
- A max height constraint `max-h-[calc(100vh-300px)]` that enables vertical scrolling
- Uses Radix `ScrollArea` component

However, the vertical scrollbar is not visible because only the horizontal `ScrollBar` component is included.

## Solution
Add a vertical `ScrollBar` component alongside the existing horizontal one.

## Technical Changes

### File: `src/components/GoalsReviewTable.tsx`

**Current code (lines 370-371):**
```tsx
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
```

**Updated code:**
```tsx
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
```

This will render both scrollbars, allowing users to scroll vertically through the list of properties while also being able to scroll horizontally across the months.

## Expected Result
- Users will see a styled vertical scrollbar on the right side of the table when there are more properties than fit in the viewport
- The horizontal scrollbar will continue to work for navigating across months
- Both scrollbars will match the existing Radix UI styling with the subtle, rounded thumb design

