
Goal
- Fix the Dispute detail drawer (the sheet that opens after clicking a dispute card) so content never “loses” the right boundary / runs off-screen, especially for the 2nd/3rd items in “Submit Claim”.

What I observed (I reproduced it)
- Navigated to /reviews → “Airbnb Disputes”.
- Clicked a non-first card in “Submit Claim”.
- The detail sheet shows conversation messages containing extremely long, unbroken HTML-like strings.
- Even though some text nodes have wrapping classes, the sheet can still end up wider than its visual container (or create horizontal overflow), which looks like “no right boundary” and clipped content.

Why the first card can look fine
- This issue is data-dependent: cards with shorter property names and/or normal conversation text don’t trigger horizontal overflow, so they appear “correct.”
- Cards that include:
  1) very long property names/labels in a flex header without proper shrink behavior, and/or
  2) message bubbles that exceed the container width due to layout technique (full-width block + side margins),
  will reveal the overflow.

Root causes (likely more than one)
1) Sheet header truncation isn’t guaranteed
- In the sheet header, the title is a flex row containing a truncating <span>.
- For truncate to work reliably inside a flex container, the flex parent (and often the truncating item) needs min-w-0; otherwise the flex item can refuse to shrink and push width outward.

2) Conversation “bubble” layout can exceed container width
- Current layout uses a block bubble with ml-4 (guest) or mr-4 (host).
- A block element defaults to effectively “fill available width”; adding left/right margin can make its total rendered width exceed the container width (width + margin), causing horizontal overflow.
- This becomes much more obvious when msg.content contains huge unbroken strings (HTML payloads, URLs, encoded blobs). Even with break-words, the container can still overflow because the bubble’s own box model is oversized.

Implementation plan (code changes)
Only frontend changes; no backend changes required.

A) Make the sheet container explicitly prevent horizontal overflow (safety net)
File: src/components/dispute/DisputeDetailSheet.tsx
- Update the SheetContent className to include overflow-x-hidden.
  - Current: className="w-full sm:max-w-2xl overflow-y-auto"
  - Change to: className="w-full sm:max-w-2xl overflow-y-auto overflow-x-hidden"
Why:
- Even if a child accidentally overflows, it won’t “blow out” the sheet visually.

B) Fix the header so long property names never expand the sheet
File: src/components/dispute/DisputeDetailSheet.tsx
- Add min-w-0 in the header chain where truncation is expected:
  1) SheetHeader: add min-w-0
     - Current: <SheetHeader className="pr-8">
     - Change:  <SheetHeader className="pr-8 min-w-0">
  2) SheetTitle: add min-w-0 and ensure the badge can’t force stretching
     - Current: <SheetTitle className="flex items-center gap-2">
     - Change:  <SheetTitle className="flex items-center gap-2 min-w-0">
     - Add shrink-0 to the “High Priority” badge so it never compresses the title:
       - <Badge ... className="shrink-0">High Priority</Badge>
Why:
- This ensures the title’s <span className="truncate"> actually truncates instead of forcing layout overflow on certain rows.

C) Rebuild conversation bubbles to avoid margin-based overflow
File: src/components/dispute/DisputeDetailSheet.tsx
In BOTH places where messages render:
- The small “Conversation History” box (around lines ~571-596)
- The expanded conversation dialog (around lines ~613-637)

Change structure from:
- One bubble div with ml-4/mr-4 margins
To:
- An outer flex row that controls alignment (justify-start / justify-end)
- An inner bubble with max width and safe wrapping

New pattern:
- Wrap each message with:
  - <div className={cn("flex", msg.sender === "guest" ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] w-fit p-3 rounded-lg text-sm overflow-hidden",
        msg.sender === "guest" ? "bg-muted" : "bg-primary/10"
      )}>
        ...
        <p className="whitespace-pre-wrap break-all">{msg.content}</p>
      </div>
    </div>

Key details:
- Remove ml-4/mr-4 entirely (those are what can cause width+margin overflow).
- Add max-w-[85%] so bubbles never exceed the drawer width.
- Use break-all (not just break-words) for message content to force-wrap truly unbroken HTML/URLs.
  - This is specifically for the “giant blob” cases; it will look normal for typical sentences.

D) (Optional but recommended) Ensure message header row can’t overflow either
File: src/components/dispute/DisputeDetailSheet.tsx
- In the message bubble header row (sender + timestamp), add gap-2 and min-w-0 so it can compress:
  - Current: className="flex items-center justify-between mb-1"
  - Change:  className="flex items-center justify-between gap-3 mb-1 min-w-0"
- If needed, truncate timestamp on very narrow screens:
  - apply "truncate" to the timestamp span and "shrink-0" to sender label, depending on what looks best.

How we’ll verify (end-to-end)
1) Go to /reviews → Airbnb Disputes.
2) In “Submit Claim”, open:
   - the 1st card (baseline)
   - the 2nd or 3rd card that previously broke (the problematic case)
3) Confirm:
   - The sheet keeps a clean right edge (no horizontal overflow).
   - Property name truncates properly in header if long.
   - Conversation content (including giant HTML blobs) wraps inside the bubble (may break mid-word, which is expected for blobs).
   - Expanded conversation dialog also wraps and stays within bounds.

Files to change
- src/components/dispute/DisputeDetailSheet.tsx
  - SheetContent: add overflow-x-hidden
  - SheetHeader/SheetTitle: add min-w-0 (+ shrink-0 on badge)
  - Conversation rendering (both compact + expanded): replace margin-based bubble alignment with flex justify + max width + break-all

Risks / trade-offs
- break-all will split long tokens aggressively (this is intentional for HTML/encoded blobs to avoid layout breakage). If you prefer, we can apply break-all only when msg.content length exceeds a threshold, but that adds complexity.
