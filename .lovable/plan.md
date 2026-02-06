

# Plan: Upgrade AI Models to Gemini 2.5 Pro

## Overview

Upgrade both review analysis edge functions to use `google/gemini-2.5-pro` for enhanced reasoning capabilities when analyzing policy violations and building dispute cases.

## Changes Required

### File 1: `supabase/functions/analyze-conversation-redflags/index.ts`

**Line 150**: Change model from `google/gemini-3-flash-preview` to `google/gemini-2.5-pro`

```typescript
// Before
model: "google/gemini-3-flash-preview",

// After
model: "google/gemini-2.5-pro",
```

### File 2: `supabase/functions/analyze-review-dispute/index.ts`

**Line 288**: Change model from `google/gemini-2.5-flash` to `google/gemini-2.5-pro`

```typescript
// Before
model: "google/gemini-2.5-flash",

// After
model: "google/gemini-2.5-pro",
```

## Benefits

| Aspect | Flash Models | Gemini 2.5 Pro |
|--------|-------------|----------------|
| Reasoning | Basic | Advanced multi-step reasoning |
| Context handling | Good | Excellent for complex legal/policy text |
| Nuance detection | Moderate | Strong at detecting subtle violations |
| Cost | Lower | Higher (but justified for legal analysis) |

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/analyze-conversation-redflags/index.ts` | Line 150: Update model |
| `supabase/functions/analyze-review-dispute/index.ts` | Line 288: Update model |

