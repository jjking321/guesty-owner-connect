
# Plan: Add Context & Red Flag Management for Re-analysis

## Overview

Allow users to:
1. Add additional context before re-running the AI red flags analysis
2. Remove/exclude individual red flag points that the AI identified if they're not relevant
3. Re-run analysis with user context and excluded flags incorporated

## Current State

- The `DisputeDetailSheet.tsx` component displays red flags from `dispute_conversation_redflags`
- The `analyze-conversation-redflags` edge function runs the analysis and stores results
- Red flags are stored as a JSON object with `redflags[]`, `overallAssessment`, and `evidenceStrength`
- There's no way to exclude flags or add user context

## Implementation

### Database Changes

Add two new columns to the `reviews` table:
- `dispute_redflags_excluded` (JSONB) - Array of excluded red flag indices
- `dispute_analysis_context` (TEXT) - User-provided additional context for re-analysis

### File 1: `src/components/dispute/DisputeDetailSheet.tsx`

#### 1. Add State Variables (after line 116)

```typescript
const [analysisContext, setAnalysisContext] = useState('');
const [excludedFlags, setExcludedFlags] = useState<number[]>([]);
const [showContextInput, setShowContextInput] = useState(false);
```

#### 2. Initialize State from Review Data (in the useEffect around line 118-124)

```typescript
useState(() => {
  if (review) {
    setEditedCaseFile(review.dispute_case_file);
    setNotes(review.dispute_notes || '');
    setAnalysisContext(review.dispute_analysis_context || '');
    setExcludedFlags(review.dispute_redflags_excluded || []);
  }
});
```

#### 3. Update handleAnalyzeRedFlags Function (line 178)

Pass context and excluded flags to the edge function:

```typescript
const handleAnalyzeRedFlags = async () => {
  setAnalyzingRedFlags(true);
  try {
    const { data, error } = await supabase.functions.invoke('analyze-conversation-redflags', {
      body: { 
        reviewId: review.id,
        additionalContext: analysisContext || undefined,
        excludedFlagIndices: excludedFlags.length > 0 ? excludedFlags : undefined,
      },
    });

    if (error) throw error;

    // Reset excluded flags after re-analysis since indices may change
    setExcludedFlags([]);
    
    toast({
      title: "Red flag analysis complete",
      description: data.message || `Found ${data.analysis?.redflags?.length || 0} red flags`,
    });
    onUpdate();
  } catch (error: any) {
    toast({
      title: "Analysis failed",
      description: error.message,
      variant: "destructive",
    });
  } finally {
    setAnalyzingRedFlags(false);
  }
};
```

#### 4. Add Toggle Exclude Function

```typescript
const handleToggleExcludeFlag = (index: number) => {
  setExcludedFlags(prev => 
    prev.includes(index) 
      ? prev.filter(i => i !== index)
      : [...prev, index]
  );
};

const handleSaveExcludedFlags = async () => {
  setUpdating(true);
  try {
    const { error } = await supabase
      .from('reviews')
      .update({ 
        dispute_redflags_excluded: excludedFlags,
        dispute_analysis_context: analysisContext,
        updated_at: new Date().toISOString(),
      })
      .eq('id', review.id);

    if (error) throw error;
    toast({ title: "Changes saved" });
    onUpdate();
  } catch (error: any) {
    toast({
      title: "Save failed",
      description: error.message,
      variant: "destructive",
    });
  } finally {
    setUpdating(false);
  }
};
```

#### 5. Update UI - Add Context Input Section (before the Analyze button, around line 588)

```tsx
{/* Additional Context for Re-analysis */}
{messages.length > 0 && (
  <div className="mb-3">
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setShowContextInput(!showContextInput)}
      className="text-xs"
    >
      <Plus className="h-3 w-3 mr-1" />
      {showContextInput ? 'Hide Context' : 'Add Context for Re-analysis'}
    </Button>
    
    {showContextInput && (
      <div className="mt-2 space-y-2">
        <Textarea
          value={analysisContext}
          onChange={(e) => setAnalysisContext(e.target.value)}
          placeholder="Add additional context the AI should consider (e.g., 'Guest was refunded after the stay', 'Host filed a damage claim before review')..."
          rows={3}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          This context will be included when re-analyzing for red flags.
        </p>
      </div>
    )}
  </div>
)}
```

#### 6. Update Red Flag Cards to Include Exclude Button (around line 633-679)

Add a checkbox/button to exclude each flag:

```tsx
{review.dispute_conversation_redflags.redflags.map((flag: RedFlag, idx: number) => {
  const isExcluded = excludedFlags.includes(idx);
  return (
    <div
      key={idx}
      className={cn(
        "p-3 rounded-lg border-l-4 relative",
        isExcluded && "opacity-50",
        flag.severity === 'high' && "border-l-destructive bg-destructive/10",
        flag.severity === 'medium' && "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
        flag.severity === 'low' && "border-l-yellow-400 bg-yellow-50 dark:bg-yellow-950/20"
      )}
    >
      {/* Exclude toggle button - top right */}
      <button
        onClick={() => handleToggleExcludeFlag(idx)}
        className={cn(
          "absolute top-2 right-2 p-1 rounded hover:bg-muted transition-colors",
          isExcluded ? "text-muted-foreground" : "text-destructive"
        )}
        title={isExcluded ? "Include this flag" : "Exclude this flag"}
      >
        {isExcluded ? <Plus className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </button>
      
      {isExcluded && (
        <Badge variant="outline" className="absolute top-2 left-2 text-xs">
          Excluded
        </Badge>
      )}
      
      {/* Existing flag content */}
      <div className="flex items-center gap-2 mb-2 pr-8">
        <Badge ...>
          {flag.category}
        </Badge>
        ...
      </div>
      ...
    </div>
  );
})}
```

#### 7. Add Save Button for Excluded Flags (after the red flags list)

```tsx
{excludedFlags.length > 0 && (
  <div className="flex items-center justify-between pt-2 border-t">
    <span className="text-sm text-muted-foreground">
      {excludedFlags.length} flag{excludedFlags.length > 1 ? 's' : ''} excluded
    </span>
    <Button size="sm" variant="outline" onClick={handleSaveExcludedFlags} disabled={updating}>
      Save Exclusions
    </Button>
  </div>
)}
```

#### 8. Add Required Imports

Add `Plus`, `X` to the lucide-react imports.

### File 2: `supabase/functions/analyze-conversation-redflags/index.ts`

#### 1. Update Request Body Parsing (line 47)

```typescript
const { reviewId, additionalContext, excludedFlagIndices } = await req.json();
```

#### 2. Update the User Prompt (around line 129)

Include the additional context if provided:

```typescript
let userPrompt = `Please analyze the following conversation and review for potential policy violations:

REVIEW TEXT:
"${review.review_text || 'No review text available'}"

GUEST: ${review.guest_name || 'Unknown'}
REVIEW DATE: ${review.review_date ? new Date(review.review_date).toLocaleDateString() : 'Unknown'}

CONVERSATION HISTORY:
${formattedConversation}`;

if (additionalContext) {
  userPrompt += `

ADDITIONAL CONTEXT FROM HOST/MANAGER:
${additionalContext}

Please factor this additional context into your analysis.`;
}

userPrompt += `

Analyze this conversation for any red flags that could support a dispute claim.`;
```

#### 3. Store Context and Clear Exclusions on Re-analysis (line 260)

```typescript
const { error: updateError } = await supabase
  .from("reviews")
  .update({
    dispute_conversation_redflags: analysis,
    dispute_conversation_analyzed_at: new Date().toISOString(),
    dispute_analysis_context: additionalContext || null,
    dispute_redflags_excluded: [], // Clear exclusions on re-analysis
    updated_at: new Date().toISOString(),
  })
  .eq("id", reviewId);
```

### File 3: Update TypeScript Interface

In `DisputeDetailSheet.tsx`, update the `DisputeReview` interface (around line 72):

```typescript
interface DisputeReview {
  // ... existing fields
  dispute_analysis_context?: string | null;
  dispute_redflags_excluded?: number[] | null;
}
```

## Visual Flow

```text
User views Red Flags section
        │
        ├── [+ Add Context for Re-analysis] button
        │         │
        │         └── Textarea appears for context input
        │
        ├── Each red flag card has [X] exclude button
        │         │
        │         └── Clicking toggles exclusion (flag becomes semi-transparent)
        │
        ├── [Save Exclusions] button appears when flags excluded
        │
        └── [Re-analyze] button
                  │
                  └── Sends context + exclusions to edge function
                            │
                            └── AI considers context, results replace old flags
```

## Database Migration Required

```sql
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS dispute_redflags_excluded JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS dispute_analysis_context TEXT;
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Add context input, exclude buttons, save handlers |
| `supabase/functions/analyze-conversation-redflags/index.ts` | Accept context & exclusions, include in prompt |
| Database migration | Add 2 new columns to `reviews` table |
