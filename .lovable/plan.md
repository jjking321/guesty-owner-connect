

# Plan: Integrate Red Flags into Dispute Analysis

## Overview

The red flags UI is already fully implemented and working. The main issue is that the `analyze-review-dispute` edge function doesn't include the previously analyzed red flags when generating the dispute case. This means the AI dispute analysis works independently from the red flag analysis, missing valuable evidence.

## Current State

### Red Flags UI (Already Complete)
The `DisputeDetailSheet.tsx` already has:
- Evidence strength badge (strong/moderate/weak)
- Overall assessment summary
- Color-coded red flag cards (high=red, medium=amber, low=yellow)
- Quoted evidence in blockquote style
- Context explanations
- Sender and timestamp info

### Missing Integration
The `analyze-review-dispute` function builds context for AI but only includes:
- Property info
- Review text and ratings
- Reservation details
- Raw conversation history

It does **not** include the structured red flags from `dispute_conversation_redflags`.

## Changes Required

### File: `supabase/functions/analyze-review-dispute/index.ts`

#### 1. Include Red Flags in Database Query (Line 79)

Add `dispute_conversation_redflags` to the select query:

```typescript
const { data: review, error: reviewError } = await supabase
  .from('reviews')
  .select(`
    *,
    listings:listing_id (
      id,
      nickname,
      address,
      guesty_account_id
    )
  `)
  .eq('id', reviewId)
  .single();
```

This already selects `*` so all columns are included, but we need to use the data.

#### 2. Add Red Flags to AI Context (After Line 200)

Insert a new section in the context that includes any previously analyzed red flags:

```typescript
// After conversation history section, before the final "---" line

if (review.dispute_conversation_redflags) {
  const redflags = review.dispute_conversation_redflags;
  context += `
## Pre-Analyzed Conversation Red Flags
Evidence Strength: ${redflags.evidenceStrength?.toUpperCase() || 'UNKNOWN'}
Assessment: ${redflags.overallAssessment || 'No assessment available'}

`;
  if (redflags.redflags && redflags.redflags.length > 0) {
    context += `### Identified Violations:\n`;
    redflags.redflags.forEach((flag: any, idx: number) => {
      context += `
**${idx + 1}. ${flag.category} (${flag.severity} severity)**
- Quote: "${flag.quote}"
- Context: ${flag.context}
- From: ${flag.sender === 'guest' ? 'Guest' : 'Host'}
`;
    });
  }
  context += `
IMPORTANT: Use these pre-analyzed red flags as supporting evidence in your dispute case. Reference the specific quotes when building your argument.
`;
}
```

#### 3. Update System Prompt to Reference Red Flags

Add a note to the system prompt about using pre-analyzed evidence (add after line 37):

```typescript
## Using Pre-Analyzed Evidence
If pre-analyzed conversation red flags are provided, incorporate them directly into your case:
- Reference the exact quotes identified
- Use the category classifications to strengthen your argument
- High-severity flags should be prominently featured in the case description
- Build your argument around the strongest evidence first
```

## Implementation Flow

```text
1. User clicks "Analyze for Red Flags"
   ↓
2. analyze-conversation-redflags runs
   ↓
3. Red flags stored in dispute_conversation_redflags
   ↓
4. UI displays red flags (already working)
   ↓
5. User clicks "Analyze" (main dispute analysis)
   ↓
6. analyze-review-dispute includes red flags in context ← NEW
   ↓
7. AI generates stronger case using pre-analyzed evidence
```

## Summary of Changes

| Line Range | Current | Change |
|------------|---------|--------|
| ~37 | System prompt ends | Add "Using Pre-Analyzed Evidence" section |
| ~200 | Context ends with conversation | Add red flags section to context |

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/analyze-review-dispute/index.ts` | Add red flags to AI context and update system prompt |

## Expected Outcome

After this change:
1. User fetches conversation → Messages appear
2. User analyzes for red flags → Red flags appear with quotes
3. User runs main dispute analysis → AI sees red flags and creates stronger case referencing the specific quotes
4. Case file includes evidence from conversation analysis

