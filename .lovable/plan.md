

# Swap Conversation Bubble Alignment

## Summary
Swap the message alignment so guest messages appear on the left and host messages appear on the right, matching the standard messaging app convention (like iMessage) where "you" (the host) is on the right side.

## Changes Required

**File:** `src/components/dispute/DisputeDetailSheet.tsx`

### 1. Compact Conversation View (lines 577-579)

```typescript
// Before:
msg.sender === 'guest' ? "justify-end" : "justify-start"

// After:
msg.sender === 'guest' ? "justify-start" : "justify-end"
```

### 2. Expanded Conversation Dialog (lines 623-625)

```typescript
// Before:
msg.sender === 'guest' ? "justify-end" : "justify-start"

// After:
msg.sender === 'guest' ? "justify-start" : "justify-end"
```

## Visual Result

| Before | After |
|--------|-------|
| Guest messages → Right | Guest messages → Left |
| Host messages → Left | Host messages → Right |

This matches the typical messaging app experience where the person you're viewing the conversation from (the host/property manager) sees their own messages on the right.

