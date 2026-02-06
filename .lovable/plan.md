

# Plan: Add Conversation Red Flags Prompt Management

## Overview

Add a new tab in the AI Prompts Settings UI for managing the "Conversation Red Flags" analysis prompt, and update the `analyze-conversation-redflags` edge function to fetch and use the custom prompt from the database.

## Current State

The `AIPromptsSettings.tsx` component already manages 3 prompts:
- Call Prep (`call_prep`)
- Revenue Actions (`revenue_actions`)
- Review Disputes (`review_dispute_analysis`)

The `analyze-conversation-redflags` edge function currently uses a hardcoded `systemPrompt` constant and does not fetch organization-specific prompts from the database.

## Changes Required

### File 1: `src/components/AIPromptsSettings.tsx`

#### 1. Add Default Prompt Constant (After line 175)

Add `DEFAULT_CONVERSATION_REDFLAGS_PROMPT` with the current prompt from the edge function:

```typescript
const DEFAULT_CONVERSATION_REDFLAGS_PROMPT = `Role: You are a Senior Policy Compliance Auditor specializing in Airbnb's Terms of Service. Your goal is to conduct a forensic analysis of guest communications to identify any specific violations of Airbnb's Content Policy that warrant a review removal.

## Official Airbnb Policy Framework

When identifying violations, match evidence to these official policy statements:

EXTORTION: Per Airbnb's Reviews Policy: "Members of the Airbnb community may not coerce, intimidate, extort, threaten, incentivize or manipulate another person in an attempt to influence a review..."

[... full prompt text ...]

Be thorough but only flag genuine policy violations with supporting evidence. If there are no clear violations, report that honestly.`;
```

#### 2. Add State Variables (After line 197)

```typescript
const [conversationRedFlagsConfig, setConversationRedFlagsConfig] = useState<PromptConfig | null>(null);
const [conversationRedFlagsPrompt, setConversationRedFlagsPrompt] = useState(DEFAULT_CONVERSATION_REDFLAGS_PROMPT);
```

#### 3. Update loadPromptConfigs (Line 216)

Add `'conversation_redflags_analysis'` to the `prompt_key` filter:

```typescript
.in('prompt_key', ['call_prep', 'revenue_actions', 'review_dispute_analysis', 'conversation_redflags_analysis']);
```

And add handling for the new prompt in the data processing:

```typescript
const conversationRedFlags = data.find(p => p.prompt_key === 'conversation_redflags_analysis');
if (conversationRedFlags) {
  setConversationRedFlagsConfig(conversationRedFlags);
  setConversationRedFlagsPrompt(conversationRedFlags.system_prompt);
}
```

#### 4. Update handleSave Function (Line 252)

Extend to handle the new prompt type:

```typescript
const handleSave = async (promptKey: 'call_prep' | 'revenue_actions' | 'review_dispute_analysis' | 'conversation_redflags_analysis') => {
  // Add conversation red flags handling
  const isConversationRedFlags = promptKey === 'conversation_redflags_analysis';
  // Update config/prompt selection logic
  // ...
}
```

#### 5. Update handleReset Function (Line 313)

Add reset case:

```typescript
} else if (promptKey === 'conversation_redflags_analysis') {
  setConversationRedFlagsPrompt(DEFAULT_CONVERSATION_REDFLAGS_PROMPT);
}
```

#### 6. Add New Tab Trigger (Line 365)

```tsx
<TabsTrigger value="conversation_redflags">Conversation Red Flags</TabsTrigger>
```

#### 7. Add New TabsContent (After line 486, before closing Tabs)

```tsx
<TabsContent value="conversation_redflags" className="space-y-4">
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <Label htmlFor="conversation-redflags-prompt" className="text-base font-medium">
        Conversation Red Flags Analysis Prompt
      </Label>
      <Button variant="outline" size="sm" onClick={() => handleReset('conversation_redflags_analysis')}>
        <RotateCcw className="mr-2 h-4 w-4" />
        Reset to Default
      </Button>
    </div>
    <p className="text-sm text-muted-foreground">
      This prompt instructs the AI how to analyze guest-host conversation history for policy violations.
      It receives the message history and review text to identify extortion, retaliation, and other red flags.
    </p>
    <Textarea
      id="conversation-redflags-prompt"
      value={conversationRedFlagsPrompt}
      onChange={(e) => setConversationRedFlagsPrompt(e.target.value)}
      className="min-h-[400px] font-mono text-sm"
      placeholder="Enter the system prompt for the AI..."
    />
  </div>
  <div className="flex justify-end">
    <Button onClick={() => handleSave('conversation_redflags_analysis')} disabled={saving}>
      {saving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        <>
          <Save className="mr-2 h-4 w-4" />
          Save Changes
        </>
      )}
    </Button>
  </div>
</TabsContent>
```

### File 2: `supabase/functions/analyze-conversation-redflags/index.ts`

#### 1. Rename Hardcoded Prompt (Line 9)

Change `const systemPrompt = ...` to `const DEFAULT_SYSTEM_PROMPT = ...`

#### 2. Add Organization Lookup and Custom Prompt Fetch (After line 77, before formatting conversation)

Following the same pattern as `analyze-review-dispute`:

```typescript
// Get the listing to find organization
const { data: listing } = await supabase
  .from("listings")
  .select("guesty_account_id")
  .eq("id", review.listing_id)
  .single();

let orgId = null;
if (listing?.guesty_account_id) {
  const { data: guestyAccount } = await supabase
    .from("guesty_accounts")
    .select("organization_id")
    .eq("id", listing.guesty_account_id)
    .single();
  orgId = guestyAccount?.organization_id;
}

// Fetch custom prompt if configured
let systemPrompt = DEFAULT_SYSTEM_PROMPT;
if (orgId) {
  const { data: promptConfig } = await supabase
    .from("ai_prompt_configs")
    .select("system_prompt")
    .eq("organization_id", orgId)
    .eq("prompt_key", "conversation_redflags_analysis")
    .single();

  if (promptConfig?.system_prompt) {
    systemPrompt = promptConfig.system_prompt;
    console.log("Using custom conversation red flags prompt");
  }
}
```

#### 3. Update Review Query (Line 67-68)

Add `listing_id` to the select:

```typescript
.select("id, listing_id, review_text, dispute_message_history, guest_name, review_date")
```

## Implementation Flow

```text
User navigates to Settings → AI Prompts
        |
        v
New "Conversation Red Flags" tab appears
        |
        v
User can view/edit the prompt
        |
        v
Save stores to ai_prompt_configs table
  with prompt_key = 'conversation_redflags_analysis'
        |
        v
When user clicks "Analyze for Red Flags"
        |
        v
Edge function fetches custom prompt from DB
        |
        v
AI uses organization-specific prompt
```

## Files to Modify

| File | Action |
|------|--------|
| `src/components/AIPromptsSettings.tsx` | Add new tab, state, and handlers for conversation red flags prompt |
| `supabase/functions/analyze-conversation-redflags/index.ts` | Fetch custom prompt from ai_prompt_configs table |

## Key Database Details

The `ai_prompt_configs` table already exists and stores prompts with:
- `organization_id` - Links to the organization
- `prompt_key` - Unique identifier (we'll use `'conversation_redflags_analysis'`)
- `prompt_name` - Display name (e.g., "Conversation Red Flags Analysis")
- `system_prompt` - The actual prompt text

No database migrations needed.

