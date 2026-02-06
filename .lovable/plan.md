

# Plan: Integrate Official Airbnb Policy Documentation into Dispute Analysis

## Overview

Enhance both dispute analysis edge functions (`analyze-review-dispute` and `analyze-conversation-redflags`) to include Airbnb's official policy language from the PDF document. This allows the AI to cite exact policy wording when building dispute cases, making them more compelling to Airbnb Support.

## Key Policy Text Extracted

### Reviews Should Be Unbiased (Extortion/Retaliation)

> "Members of the Airbnb community may not coerce, intimidate, extort, threaten, incentivize or manipulate another person in an attempt to influence a review, like promising compensation in exchange for a positive review or threatening consequences in the event of a negative review."

> "Reviews may not be provided or withheld in exchange for something of value—like a discount, refund, reciprocal review, or promise not to take negative action against the reviewer. They also may not be used as an attempt to mislead or deceive Airbnb or another person. For example, guests should not write biased or inauthentic reviews as a form of retaliation against a host who enforces a policy or rule."

### Reviews Should Be Relevant

> "Reviews must provide relevant information about the reviewer's experience with the host, guest, stay, or experience that would help other community members make informed booking and hosting decisions."

> "If a guest never arrived for their stay or experience, or had to cancel due to circumstances unrelated to that stay or experience, their review may be removed."

### Third-Party/Inauthentic Reviews

> "Reviews may only be provided in connection with a genuine stay or experience. For example, hosts are not allowed to accept a fake reservation in exchange for a positive review, use a second account to leave themselves a review, or coordinate with others to manipulate the review system."

### Content Policy Violations

> "Content that endorses or promotes illegal or harmful activity, or that is sexually explicit, violent, graphic, threatening, or harassing"

> "Content that includes another person's private information, including content that is sufficient to identify a listing's location"

### Anecdotal Success Criteria

From the document's property manager guidance:
- Guest did not enter/stay in unit = review should be removed
- Guest booked for someone else and wrote review = removable
- Guest threatened bad review after declined refund request = highly likely removal
- Bad review filed after damage claim = grounds for removal
- Review contains profanity, names, addresses, or links = will be removed
- Complaints about weather, construction, or neighborhood = irrelevant, can be removed

## Changes Required

### File 1: `supabase/functions/analyze-review-dispute/index.ts`

**Update the DEFAULT_SYSTEM_PROMPT** to include quotable policy text:

Add a new section after the Airbnb's 5 Dispute Categories:

```typescript
## Official Airbnb Policy Text (Quote Directly When Applicable)

### Extortion/Coercion Policy
Per Airbnb's Reviews Policy: "Members of the Airbnb community may not coerce, intimidate, extort, threaten, incentivize or manipulate another person in an attempt to influence a review, like promising compensation in exchange for a positive review or threatening consequences in the event of a negative review."

Also: "Reviews may not be provided or withheld in exchange for something of value—like a discount, refund, reciprocal review, or promise not to take negative action against the reviewer."

### Retaliation Policy  
Per Airbnb's Reviews Policy: "Guests should not write biased or inauthentic reviews as a form of retaliation against a host who enforces a policy or rule."

### Relevance Policy
Per Airbnb's Reviews Policy: "Reviews must provide relevant information about the reviewer's experience with the host, guest, stay, or experience."

Also: "If a guest never arrived for their stay or experience, or had to cancel due to circumstances unrelated to that stay or experience, their review may be removed."

### Third-Party/Authenticity Policy
Per Airbnb's Reviews Policy: "Reviews may only be provided in connection with a genuine stay or experience."

### Content Policy
Per Airbnb's Content Policy: Reviews may not contain "content that is sexually explicit, violent, graphic, threatening, or harassing" or "content that includes another person's private information."

## Case Building Instructions
When building your dispute case:
1. Identify which specific policy was violated
2. Quote the exact policy language in your case description
3. Show how the guest's actions/review directly violates the quoted policy
4. Cite specific evidence (conversation quotes, timeline, behavior patterns)
```

**Update the tool schema** to include a new field for policy citations:

```typescript
policyCitations: {
  type: "array",
  items: { type: "string" },
  description: "Exact Airbnb policy quotes that support the dispute case"
}
```

### File 2: `supabase/functions/analyze-conversation-redflags/index.ts`

**Update the systemPrompt** to include policy references:

```typescript
## Official Airbnb Policy Framework

When identifying violations, match evidence to these official policy statements:

EXTORTION: "Members may not coerce, intimidate, extort, threaten, incentivize or manipulate another person in an attempt to influence a review."

RETALIATION: "Guests should not write biased or inauthentic reviews as a form of retaliation against a host who enforces a policy or rule."

THIRD-PARTY: "Reviews may only be provided in connection with a genuine stay or experience."

IRRELEVANT: "Reviews must provide relevant information about the reviewer's experience."

For each red flag, cite which specific policy clause it violates.
```

**Update the tool schema** to include policy reference:

```typescript
policyViolated: {
  type: "string",
  description: "The specific Airbnb policy text that this evidence violates"
}
```

## Implementation Details

### Updated System Prompt Structure for analyze-review-dispute

```
1. Role and Objective
2. Airbnb's 5 Dispute Categories (existing)
3. Official Airbnb Policy Text (NEW - quotable policies)
4. Analysis Guidelines (existing)
5. Case Building Instructions (NEW - how to cite policies)
6. Conversation Red Flags (existing)
7. Scoring Guidelines (existing)
8. Using Pre-Analyzed Evidence (existing)
```

### Updated Tool Schema for analyze-review-dispute

Add `policyCitations` field:
- Type: Array of strings
- Contains exact policy quotes used in the case
- These will be stored in the case file for easy copy/paste

### Updated Case File Storage

Extend the `caseFile` object to include:
```typescript
const caseFile = {
  category_reason: analysis.categoryReason,
  description: analysis.caseDescription,
  violation_category: analysis.violationCategory,
  likelihood_score: analysis.likelihoodScore,
  policy_citations: analysis.policyCitations, // NEW
  generated_at: new Date().toISOString(),
};
```

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/analyze-review-dispute/index.ts` | Add official policy text to prompt, update tool schema, store policy citations |
| `supabase/functions/analyze-conversation-redflags/index.ts` | Add policy framework to prompt, add policyViolated field to red flag schema |

## Expected Outcome

After implementation:
1. **Stronger Cases**: AI will cite exact policy language like "Per Airbnb's Reviews Policy: 'Guests should not write biased or inauthentic reviews as a form of retaliation...'"
2. **Better Evidence Matching**: Red flags will explicitly reference which policy clause was violated
3. **Copy-Paste Ready**: Case descriptions will include quotable policy text ready for Airbnb dispute submission
4. **Higher Success Rate**: Airbnb Support sees their own policy language reflected back, strengthening credibility

## Sample Output Enhancement

**Before:**
> "This review appears to be retaliatory because the guest left it after being charged for damages."

**After:**
> "This review violates Airbnb's Reviews Policy which states: 'Guests should not write biased or inauthentic reviews as a form of retaliation against a host who enforces a policy or rule.' The guest filed this 1-star review on [date], exactly 24 hours after the host submitted a damage claim for $500. The timeline clearly establishes a retaliatory pattern prohibited by Airbnb policy."

