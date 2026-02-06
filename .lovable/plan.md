

# Plan: Scrollable Conversation History with Expand Popup

## Overview

Enhance the conversation history section in the DisputeDetailSheet with:
1. A proper ScrollArea component for smooth scrolling
2. An "Expand" button to open the full conversation in a popup dialog
3. Better visual styling for the message container

## Current Implementation

The conversation history currently uses a basic `div` with `max-h-60 overflow-y-auto`:

```tsx
<div className="space-y-3 max-h-60 overflow-y-auto">
  {messages.map((msg: any, idx: number) => (
    // ... message bubbles
  ))}
</div>
```

## Proposed Changes

### 1. Add State for Popup Dialog

Add a new state variable to control the expanded conversation dialog:

```tsx
const [conversationExpanded, setConversationExpanded] = useState(false);
```

### 2. Import Dialog Components

Add Dialog imports to the existing imports:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Maximize2 } from "lucide-react";
```

### 3. Create Reusable Message Component

Extract the message rendering into a reusable component to avoid duplication:

```tsx
const MessageBubble = ({ msg, showFullTimestamp = false }: { msg: any; showFullTimestamp?: boolean }) => (
  <div
    className={cn(
      "p-3 rounded-lg text-sm",
      msg.sender === 'guest' 
        ? "bg-muted ml-4" 
        : "bg-primary/10 mr-4"
    )}
  >
    <div className="flex items-center justify-between mb-1">
      <span className="font-medium text-xs">
        {msg.sender === 'guest' ? 'Guest' : 'Host'}
      </span>
      <span className="text-xs text-muted-foreground">
        {msg.timestamp 
          ? (showFullTimestamp 
              ? new Date(msg.timestamp).toLocaleString() 
              : new Date(msg.timestamp).toLocaleDateString())
          : ''}
      </span>
    </div>
    <p className="whitespace-pre-wrap">{msg.content}</p>
  </div>
);
```

### 4. Update Conversation History Section

Replace the current implementation with a proper ScrollArea and add an Expand button:

```tsx
{/* Conversation History */}
<div>
  <div className="flex items-center justify-between mb-3">
    <Label className="text-sm font-medium flex items-center gap-2">
      <MessageSquare className="h-4 w-4" />
      Conversation History ({messages.length} messages)
    </Label>
    <div className="flex gap-2">
      {messages.length > 0 && (
        <Button 
          size="sm" 
          variant="ghost"
          onClick={() => setConversationExpanded(true)}
        >
          <Maximize2 className="h-4 w-4 mr-1" />
          Expand
        </Button>
      )}
      <Button 
        size="sm" 
        variant="outline" 
        onClick={handleFetchConversation} 
        disabled={fetchingConversation}
      >
        {fetchingConversation ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
        )}
        {messages.length > 0 ? 'Refresh' : 'Fetch'}
      </Button>
    </div>
  </div>

  {messages.length > 0 ? (
    <ScrollArea className="h-60 rounded-md border p-3">
      <div className="space-y-3 pr-4">
        {messages.map((msg: any, idx: number) => (
          <MessageBubble key={idx} msg={msg} />
        ))}
      </div>
    </ScrollArea>
  ) : (
    <p className="text-sm text-muted-foreground">
      No conversation history available. Click "Fetch" to retrieve messages.
    </p>
  )}
</div>
```

### 5. Add Expanded Conversation Dialog

Add a Dialog component after the conversation history section for the expanded view:

```tsx
{/* Expanded Conversation Dialog */}
<Dialog open={conversationExpanded} onOpenChange={setConversationExpanded}>
  <DialogContent className="max-w-3xl max-h-[80vh]">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5" />
        Conversation History - {review.guest_name || 'Guest'}
      </DialogTitle>
    </DialogHeader>
    <ScrollArea className="h-[60vh] pr-4">
      <div className="space-y-4">
        {messages.map((msg: any, idx: number) => (
          <MessageBubble key={idx} msg={msg} showFullTimestamp />
        ))}
      </div>
    </ScrollArea>
  </DialogContent>
</Dialog>
```

## Visual Design

### Inline View (in Sheet)
- Height: 240px (h-60)
- Bordered container with rounded corners
- Visible scrollbar for easy navigation
- "Expand" button in header

### Expanded Popup View
- Large dialog (max-w-3xl)
- Maximum height of 80vh
- Full timestamps shown
- More breathing room between messages

## File to Modify

| File | Changes |
|------|---------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add Dialog import, state, MessageBubble component, ScrollArea wrapper, and expanded dialog |

## Technical Details

- The `MessageBubble` component will be defined inside the main component to access the `cn` utility
- ScrollArea from shadcn provides a styled scrollbar that matches the design system
- The Dialog opens on top of the Sheet (both use portals with proper z-index)
- `showFullTimestamp` prop allows the expanded view to show date AND time

