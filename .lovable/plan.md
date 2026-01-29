
Goal
- Make the Goals Review table actually scroll vertically (and show an accessible vertical scrollbar) so you can get past “114 N Orlando Ave”.

What’s happening (root cause)
- Our `ScrollArea` viewport is set to `h-full` (100% height).
- In `GoalsReviewTable.tsx` the `ScrollArea` root only has a `max-h-[calc(100vh-300px)]` (no explicit `height`).
- In CSS, percentage heights (like `h-full`) don’t work reliably unless the parent has an explicit height.
- Result: the viewport can end up sizing to its content instead of becoming a constrained scroll container, so content gets clipped and you can’t scroll further (exactly what you’re seeing at that “114 N Orlando Ave” cutoff).

Implementation approach
- Give the Goals Review table scroll container an explicit height (not just max-height), matching the pattern already used on the Reservations page where scrolling works (`h-[calc(100vh-320px)]`).
- Keep `scrollbars="both"` so the Radix scrollbars render correctly.

Changes to make

1) Update the Goals Review scroll container height (primary fix)
- File: `src/components/GoalsReviewTable.tsx`
- Change the `ScrollArea` className from using `max-h-[calc(100vh-300px)]` to an explicit height:
  - Replace:
    - `max-h-[calc(100vh-300px)]`
  - With:
    - `h-[calc(100vh-300px)]`
- Keep `scrollbars="both"`.

2) (Optional but recommended) Prevent layout/scroll quirks by matching the known-good wrapper pattern
- File: `src/components/GoalsReviewTable.tsx`
- Wrap the `ScrollArea` in a container like:
  - `div` with `border rounded-lg overflow-hidden bg-card`
- Then remove `border rounded-lg` from the `ScrollArea` itself (so we don’t double-border).
- This matches what we do in `Reservations.tsx` and reduces “scroll chaining” and clipping issues.

How we’ll verify
- Go to `/goals-review`
- Hover the table and scroll down with mouse wheel/trackpad: confirm you can move past “114 N Orlando Ave”.
- Drag the vertical scrollbar thumb: confirm it moves and continues past that row.
- Also verify horizontal scrolling still works and the sticky header/left columns still behave correctly.

Edge cases to check
- Smaller laptop screens (short viewport height): table should still scroll and not clip.
- Very small portfolios (few rows): the fixed-height container will show empty space; if that’s undesirable, we can refine later (e.g., use a responsive min/max strategy), but this fix prioritizes correct scrolling for large portfolios.
