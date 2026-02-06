

# Plan: Fix Guesty Conversation API Response Parsing

## Problem

The current implementation parses Guesty API responses incorrectly. The actual response structure nests data under `data.conversations` and `data.posts`, not at the top level.

## Changes Required

### File: `supabase/functions/fetch-dispute-conversation/index.ts`

### 1. Update Conversations URL (Line 347)

Add `&limit=1` to the query since we only need the first matching conversation:

```typescript
// Current
const conversationsUrl = `...?filters=${encodeURIComponent(filters)}`;

// Fixed
const conversationsUrl = `...?filters=${encodeURIComponent(filters)}&limit=1`;
```

### 2. Fix Conversations Response Parsing (Lines 350-351)

```typescript
// Current (wrong)
const conversations = conversationsData.results || conversationsData.data || [];

// Fixed (correct nested structure)
const conversations = conversationsData?.data?.conversations || [];
```

### 3. Update Posts URL (Line 374)

Add `?limit=100` to fetch more messages:

```typescript
// Current
const postsUrl = `.../${conversationId}/posts`;

// Fixed
const postsUrl = `.../${conversationId}/posts?limit=100`;
```

### 4. Fix Posts Response Parsing (Lines 377-378)

```typescript
// Current (wrong)
const posts = postsData.results || postsData.data || postsData || [];

// Fixed (correct nested structure)
const posts = postsData?.data?.posts || [];
```

### 5. Update Message Transformation (Lines 381-396)

Align with the correct field names from your reference:

```typescript
const messages = posts.map((post: any) => {
  const isGuest = post.sender?.type === 'guest' || post.sentBy === 'guest';
  const text = post.body || post.message || post.content || '';
  
  return {
    id: post._id || post.id,
    timestamp: post.createdAt || post.sentAt || new Date().toISOString(),
    sender: isGuest ? 'guest' : 'host',
    senderName: post.sender?.name || post.sender?.fullName || (isGuest ? 'Guest' : 'Host'),
    content: text,
    source: post.source || 'unknown',
  };
}).filter((m: any) => m.content.trim().length > 0)
  .sort((a: any, b: any) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
```

## Summary of Changes

| Line | Current | Fixed |
|------|---------|-------|
| 347 | `?filters=...` | `?filters=...&limit=1` |
| 350 | `conversationsData.results \|\| conversationsData.data` | `conversationsData?.data?.conversations` |
| 374 | `/posts` | `/posts?limit=100` |
| 377 | `postsData.results \|\| postsData.data` | `postsData?.data?.posts` |
| 381-396 | Complex sender detection | Simplified with `sentBy` check and empty message filter |

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/fetch-dispute-conversation/index.ts` | Fix API URL params and response parsing |

