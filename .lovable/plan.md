

# Fix: Improve Batch Dispute Analysis Rate Limit Handling & Error Recovery

## Problems Identified

| Issue | Location | Impact |
|-------|----------|--------|
| Wrong response field | Line 117: `convData.messageCount` | Always logs "0 messages" even when messages exist |
| Silent continuation on 500 errors | Lines 103-118 | Proceeds to AI analysis without conversation history |
| No OAUTH_RATE_LIMIT detection | Conversation fetch handling | Doesn't detect when Guesty OAuth is rate-limited |
| Insufficient inter-review delay | Line 220: 2000ms | May hit Guesty's 15/second or 120/minute limits |

## Changes to `supabase/functions/batch-analyze-disputes/index.ts`

### 1. Fix Message Count Logging

```typescript
// Current (line 117)
console.log(`Fetched ${convData.messageCount || 0} messages`);

// Fixed
const messageCount = convData.messages?.length || 0;
console.log(`Fetched ${messageCount} messages`);
```

### 2. Improve Conversation Fetch Error Handling

**Current behavior:** Silently continues to analysis on any non-429 error

**New behavior:**
- **429 Rate Limit**: Skip review, wait 5s (already handled)
- **500/502/503 errors**: Skip review (Guesty API issue), wait 3s
- **OAUTH_RATE_LIMIT in error message**: Stop batch entirely with clear message
- **404 errors**: Log warning but continue (conversation may not exist)
- **Track if messages were fetched**: Only proceed to red flag analysis if we got messages

### 3. Add Variable to Track Conversation Success

```typescript
let conversationFetched = false;
let messageCount = 0;

// After conversation fetch...
if (convResponse.ok) {
  const convData = await convResponse.json();
  messageCount = convData.messages?.length || 0;
  conversationFetched = messageCount > 0;
  console.log(`Fetched ${messageCount} messages`);
}

// Skip red flag analysis if no messages (nothing to analyze)
if (!conversationFetched) {
  console.log(`Skipping red flag analysis: no conversation history`);
  // Jump directly to final analysis (can still check review text)
}
```

### 4. Detect OAUTH_RATE_LIMIT Errors

```typescript
if (!convResponse.ok) {
  const errorText = await convResponse.text();
  
  // Check for OAuth rate limit (propagated from fetch-dispute-conversation)
  if (errorText.includes('OAUTH_RATE_LIMIT')) {
    console.log('Guesty OAuth rate limited, stopping batch');
    return new Response(JSON.stringify({
      success: false,
      message: 'Guesty authentication rate limited. Please wait a few minutes.',
      processed,
      skipped: skipped + (triageReviews.length - results.length),
      results,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Handle server errors (Guesty API down)
  if (convResponse.status >= 500) {
    console.log(`Guesty API error (${convResponse.status}), skipping review`);
    result.error = `Guesty API error: ${convResponse.status}`;
    skipped++;
    results.push(result);
    await delay(3000);
    continue;
  }
  // ... existing 429 handling
}
```

### 5. Increase Inter-Review Delay

```typescript
// Current: 2000ms between reviews
// New: 3000ms to stay well under Guesty's 15/second limit
// Each review makes 2-3 Guesty API calls internally
await delay(3000);
```

## Updated Processing Flow

```text
For each triage review:
│
├─ Fetch Conversation
│   ├─ OAUTH_RATE_LIMIT → STOP BATCH (return 429)
│   ├─ 429 → skip review, wait 5s
│   ├─ 500+ → skip review, wait 3s  
│   ├─ 404 → log warning, continue (no messages)
│   └─ 200 → track messageCount
│
├─ If messages found:
│   └─ Analyze Red Flags (1s delay before)
│       ├─ 402 → STOP BATCH (AI credits)
│       ├─ 429 → skip review
│       └─ Success → continue
│
├─ Final Dispute Analysis (1s delay before)
│   ├─ 402 → STOP BATCH
│   └─ Success → update status
│
└─ Wait 3s before next review
```

## Summary of Changes

| Current | Fixed |
|---------|-------|
| `convData.messageCount` (undefined) | `convData.messages?.length` |
| Continue on 500 errors | Skip and wait 3s |
| No OAuth rate limit detection | Stop batch on OAUTH_RATE_LIMIT |
| 2s delay between reviews | 3s delay between reviews |
| Always run red flag analysis | Skip if no messages fetched |

