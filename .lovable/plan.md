

# Fix Vertical Scrollbar in Goals Review Table

## Problem Analysis

The current implementation has a structural issue with how Radix UI ScrollArea works:

1. **Current `ScrollArea` component (line 10-14):**
   ```tsx
   <ScrollAreaPrimitive.Root ...>
     <ScrollAreaPrimitive.Viewport>{children}</ScrollAreaPrimitive.Viewport>
     <ScrollBar />  // Only vertical, hardcoded
     <ScrollAreaPrimitive.Corner />
   </ScrollAreaPrimitive.Root>
   ```

2. **Current `GoalsReviewTable` usage:**
   ```tsx
   <ScrollArea>
     <div>...table...</div>
     <ScrollBar orientation="vertical" />   // Goes INSIDE viewport - wrong!
     <ScrollBar orientation="horizontal" /> // Goes INSIDE viewport - wrong!
   </ScrollArea>
   ```

The `ScrollBar` components are being placed INSIDE the viewport (as children), but Radix requires them to be SIBLINGS of the viewport.

## Solution

Modify the `ScrollArea` component to accept a `scrollbars` prop that controls which scrollbars are rendered:

### File: `src/components/ui/scroll-area.tsx`

**Updated component:**
```tsx
interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  scrollbars?: "vertical" | "horizontal" | "both";
}

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(({ className, children, scrollbars = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    {(scrollbars === "vertical" || scrollbars === "both") && (
      <ScrollBar orientation="vertical" />
    )}
    {(scrollbars === "horizontal" || scrollbars === "both") && (
      <ScrollBar orientation="horizontal" />
    )}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
```

### File: `src/components/GoalsReviewTable.tsx`

**Updated usage (simplified):**
```tsx
<ScrollArea className="border rounded-lg max-h-[calc(100vh-300px)]" scrollbars="both">
  <div className="w-max min-w-full">
    <Table>
      ...
    </Table>
  </div>
</ScrollArea>
```

Remove the manual `ScrollBar` components from children since they'll now be rendered by the `ScrollArea` component itself.

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/ui/scroll-area.tsx` | Add `scrollbars` prop to control which scrollbars are rendered as siblings of viewport |
| `src/components/GoalsReviewTable.tsx` | Use `scrollbars="both"` prop instead of manually adding ScrollBar children |

## Expected Result

- Both vertical and horizontal scrollbars will appear correctly
- Vertical scrollbar on the right side when content exceeds height
- Horizontal scrollbar at the bottom when content exceeds width
- Styled consistently with the Radix UI design

