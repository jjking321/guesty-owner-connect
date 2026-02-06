

# Plan: Conversation Red Flag Analysis for Dispute Evidence

## Overview

Create a new edge function `analyze-conversation-redflags` that uses AI to perform a forensic analysis of guest-host conversation history to identify policy violations that support review removal. The analysis results will be displayed in the DisputeDetailSheet UI with extracted quotes highlighted.

## Database Changes

Add new columns to the `reviews` table to store conversation analysis results:

| Column | Type | Description |
|--------|------|-------------|
| `dispute_conversation_redflags` | JSONB | Array of identified red flags with quotes |
| `dispute_conversation_analyzed_at` | TIMESTAMPTZ | When conversation was analyzed |

## New Edge Function

### File: `supabase/functions/analyze-conversation-redflags/index.ts`

This function will:
1. Accept a `reviewId` and fetch the stored `dispute_message_history`
2. Include the review text for cross-referencing
3. Call Lovable AI with a policy compliance analysis prompt
4. Use tool calling to extract structured red flag data
5. Store results back to the reviews table

### AI System Prompt

```
Role: You are a Senior Policy Compliance Auditor specializing in Airbnb's Terms of Service. 
Your goal is to conduct a forensic analysis of guest communications to identify any specific 
violations of Airbnb's Content Policy that warrant a review removal.

Task: Analyze the message_history and review_text to identify evidentiary support for removal. 
You are looking for high-confidence matches in the following categories:

1. Policy-Violating Financial Inducement (Extortion): Identify any instance where a guest 
   mentions a financial outcome (refunds, discounts, extra services) in connection with 
   their feedback or review status. Document these as potential violations of the Extortion Policy.

2. Conflict of Interest (Retaliatory): Identify if the review was submitted following the 
   host's enforcement of House Rules (e.g., smoking, unauthorized guests, noise) or the 
   filing of a reimbursement claim. Document the timeline to establish a retaliatory pattern.

3. Inauthentic/Irrelevant (Third-Party): Identify if the guest indicates they were not 
   the primary person experiencing the stay (e.g., booking for others). Flag references 
   to issues outside the host's control (e.g., local infrastructure, weather).

4. Evidence Extraction: Extract and quote the exact snippets from the message history 
   that provide the strongest evidence for these violations. These quotes will be used 
   to provide factual documentation to Airbnb Support agents.
```

### Tool Schema for Structured Output

```typescript
{
  name: "submit_conversation_analysis",
  parameters: {
    type: "object",
    properties: {
      redflags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["Extortion", "Retaliatory", "Third-Party", "Irrelevant", "None"]
            },
            severity: {
              type: "string",
              enum: ["high", "medium", "low"]
            },
            quote: {
              type: "string",
              description: "Exact quote from conversation"
            },
            context: {
              type: "string",
              description: "Brief explanation of why this is a red flag"
            },
            sender: {
              type: "string",
              enum: ["guest", "host"]
            },
            timestamp: {
              type: "string",
              description: "When this message was sent"
            }
          },
          required: ["category", "severity", "quote", "context", "sender"]
        }
      },
      overallAssessment: {
        type: "string",
        description: "1-2 sentence summary of conversation red flags"
      },
      evidenceStrength: {
        type: "string",
        enum: ["strong", "moderate", "weak", "none"]
      }
    }
  }
}
```

## Frontend Changes

### File: `src/components/dispute/DisputeDetailSheet.tsx`

Add a new section between "Conversation History" and "Case File" to display red flag analysis:

**New UI Elements:**
- "Analyze Conversation" button (only shown when messages exist)
- Red flag cards showing:
  - Category badge (color-coded by severity)
  - Quoted text in a blockquote style
  - Context explanation
  - Timestamp of the message
- Overall assessment summary
- Evidence strength indicator

**Visual Design:**
- High severity: Red border and background tint
- Medium severity: Orange/amber styling
- Low severity: Yellow styling
- Quotes displayed in italics with quotation marks

### Component Structure

```tsx
{/* Conversation Red Flags */}
{messages.length > 0 && (
  <div>
    <div className="flex items-center justify-between mb-3">
      <Label className="text-sm font-medium flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Conversation Red Flags
      </Label>
      <Button onClick={handleAnalyzeConversation}>
        Analyze for Red Flags
      </Button>
    </div>
    
    {review.dispute_conversation_redflags ? (
      <div className="space-y-3">
        {/* Evidence Strength Badge */}
        <Badge variant="...">Evidence: {evidenceStrength}</Badge>
        
        {/* Overall Assessment */}
        <p className="text-sm">{overallAssessment}</p>
        
        {/* Red Flag Cards */}
        {redflags.map((flag, idx) => (
          <Card className={severityStyles[flag.severity]}>
            <Badge>{flag.category}</Badge>
            <blockquote className="italic">"{flag.quote}"</blockquote>
            <p>{flag.context}</p>
            <span>{flag.sender} - {flag.timestamp}</span>
          </Card>
        ))}
      </div>
    ) : (
      <p>Click "Analyze" to scan conversation for policy violations.</p>
    )}
  </div>
)}
```

## Implementation Flow

```text
User clicks "Analyze for Red Flags"
        |
        v
Frontend calls edge function
        |
        v
Edge function fetches review + messages from DB
        |
        v
Builds prompt with conversation history
        |
        v
Calls Lovable AI with tool calling
        |
        v
Parses structured red flag response
        |
        v
Saves results to reviews table
        |
        v
Returns results to frontend
        |
        v
UI displays color-coded red flag cards
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/analyze-conversation-redflags/index.ts` | Create new edge function |
| `src/components/dispute/DisputeDetailSheet.tsx` | Add red flags UI section |
| Database migration | Add `dispute_conversation_redflags` and `dispute_conversation_analyzed_at` columns |

## Technical Notes

- The edge function follows the existing Guesty rate limit pattern for robustness
- Tool calling ensures structured, parseable output from the AI
- Red flags are stored as JSONB for flexible querying
- Analysis is separate from the main dispute analysis to allow independent re-runs
- Quotes can be copied directly for use in Airbnb dispute submission

