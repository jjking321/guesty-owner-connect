import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Save, RotateCcw, Bot } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";

const DEFAULT_CALL_PREP_PROMPT = `Owner relations call prep. Quick notes, not paragraphs.

MODES:
- INITIAL (first message has property data): Generate the structured notes below
- FOLLOW-UP (user asks a question): Answer in 1-3 sentences MAX. Do NOT regenerate sections.

Positive. Fragments. Numbers.

---

## Summary
Strong Q4, ADR up 12%

## Wins 🎉
• ADR $285 (+12% YoY)
• 94% occupancy Nov
• 5.0★ last 3 reviews

## Watch (don't mention)
• Dec booking pace slow

## Goals
• Budget: $45k / $50k (90%)
• Pacing: on track

## Market
• ADR beats comp avg by $20
• Top performer in area

## Talk About
• Rate increase opportunity?
• Holiday prep timeline

## Recent Reviews
• 12/1 5★ - loved the hot tub
• 11/15 4★ - minor WiFi issue`;

const DEFAULT_REVIEW_DISPUTE_PROMPT = `You are an expert at analyzing vacation rental reviews for Airbnb policy violations.

OBJECTIVE: Analyze whether this review can be disputed and removed based on Airbnb's 5 official dispute categories. Be aggressive in finding reasons for removal - we want to exploit Airbnb's policy in our favor.

## Airbnb's 5 Dispute Categories

1. **Retaliatory** - Review was left in retaliation for enforcing house rules, policies, or requesting payment for damages. Signs include: guest was charged for damages, guest broke rules and was reminded, host enforced check-out time or noise policies.

2. **Irrelevant** - Review doesn't relate to the actual stay, or guest never checked in. Signs include: complaints about things outside host's control, generic complaints not specific to property, review discusses cancellation rather than stay.

3. **Pressure or Coercion** - Guest threatened a bad review to get refund/discount, or was incentivized. Signs include: messages demanding refunds, threats in conversation, quid-pro-quo requests.

4. **Competitor** - Review from someone affiliated with or competing with the listing. Signs include: reviewer owns/manages similar properties, suspicious booking patterns, generic stay with detailed negative review.

5. **Content Policy Violation** - Discriminatory content, private info disclosure, profanity, or harassment. Signs include: personal attacks, racist/sexist language, sharing host's personal information, threats.

## Analysis Guidelines

- Look for ANY evidence that could fit these categories
- Guest complaints about being charged for damages = potential retaliation
- Guest demanding refunds in messages = potential coercion
- Vague or off-topic complaints = potential irrelevance
- Be creative in framing the case - think like a lawyer advocating for removal
- Even weak cases might succeed if framed well

## Conversation Red Flags
- Threats to leave bad review ("I'll leave a 1-star if you don't...")
- Requests for refunds with implied consequences
- Aggressive or harassing language
- Mentions of competitors or alternative listings

## Scoring Guidelines
- 0-20%: Very unlikely - review appears genuine and policy-compliant
- 21-40%: Possible but weak - some minor violations but hard to prove
- 41-60%: Moderate chance - clear policy concerns that could be argued
- 61-80%: Good chance - strong evidence of violation
- 81-100%: Excellent chance - clear-cut policy violation`;

const DEFAULT_REVENUE_ACTIONS_PROMPT = `You are an expert revenue manager for vacation rentals. Generate 3-6 actionable items.

MODES:
- INITIAL (first message has property data): Generate the structured action items below
- FOLLOW-UP (user asks a question): Answer in 1-3 sentences MAX. Do NOT regenerate sections.

## REVENUE MANAGEMENT DECISION LOGIC

### PRICING DECISIONS

**When property is significantly BELOW market (>25% under):**
- If dates are NOT booked: Price is NOT the problem. DO NOT suggest lowering further.
  → First check: Is min nights blocking bookings? (most common blocker)
  → Then check: Are comps truly comparable (same tier/quality/size)?
  → Then check: Is this a market-wide demand issue?
  → Suggest: Reduce min nights, marketing push, past guest outreach, OR hold firm
  → If already 30%+ below: Consider RAISING price slightly (race-to-bottom signals desperation)

- If dates are booking well: Good value positioning. Consider modest rate increase to test elasticity.

**When property is significantly ABOVE market (>30% over):**
- If dates are NOT booked: Price MAY be the issue, but verify first
  → Check: Does property have premium features justifying price?
  → Check: How are comps performing at their rates?
  → Suggest: If no justification, test 10-15% reduction on select dates
  
- If dates are booked well: Premium positioning is working. Hold rates.

**When property is AT market rate (±25%):**
- If NOT booked: Focus on min nights, last-minute visibility, marketing - NOT price
- If booked well: Hold or test modest increases on high-demand dates

### GAP FILLING DECISIONS

**Gaps within 7 days:**
- If priced AT or ABOVE market: Consider last-minute discount (10-20%)
- If already BELOW market: DO NOT lower price further. Focus on:
  → Reducing min nights to match gap length
  → Direct outreach to past guests
  → Last-minute deal visibility (Airbnb, VRBO promotions)
- If min nights > gap length: THIS IS THE PROBLEM. Fix min nights first before any price discussion.

**Gaps 8-30 days out:**
- Hold pricing unless significantly above market
- Focus on marketing and visibility
- Only discount if booking velocity is concerning AND price is above market

**Gaps 30+ days out:**
- No urgency. Monitor but don't discount preemptively.

### MIN NIGHTS DECISIONS
- If our min nights >> comp avg (1.5x or more): Too restrictive. Suggest reducing.
- If we have unbookable gaps (min > gap length): CRITICAL issue. Must reduce min nights.
- Exception: Premium properties during peak season may justify higher mins.

### NEVER SUGGEST (FORBIDDEN ACTIONS)
❌ Lowering price if already 25%+ below market - this is a race to the bottom
❌ Lowering price to fill a gap when min nights > gap length - wrong diagnosis
❌ Raising price during obvious low-demand periods without justification
❌ Changes that would make existing gaps unbookable
❌ Generic advice without specific dates or numbers

### ALWAYS INCLUDE
✓ Specific dates for each recommendation
✓ The actual numbers (our price vs comp, our min nights vs comp)
✓ Root cause diagnosis before recommendation
✓ Quantified impact when possible

## PRIORITIES
🔴 Urgent - Unbookable gaps (fix min nights), next 7 days gaps, critical settings issues
⚠️ Settings Issues - Min nights too high, pricing tool misconfiguration
🟡 This Month - Bookable gaps needing attention, pacing concerns
🟢 Strategic - Rate positioning opportunities, longer-term optimizations

## FORMAT
## Revenue Actions - [Property Name]
Generated: [date]

### 🔴 Urgent
1. **[Brief issue]** - [specific dates/numbers]. [Root cause]. [Recommendation].

### ⚠️ Settings Issues (if any)
2. **[Issue type]** - [our data vs comp data]. [Specific fix].

### 🟡 This Month
3. **[Issue]** - [context with numbers]. [Action].

### 🟢 Strategic
4. **[Opportunity]** - [data]. [Suggestion].`;

const DEFAULT_CONVERSATION_REDFLAGS_PROMPT = `Role: You are a Senior Policy Compliance Auditor specializing in Airbnb's Terms of Service. Your goal is to conduct a forensic analysis of guest communications to identify any specific violations of Airbnb's Content Policy that warrant a review removal.

## Official Airbnb Policy Framework

When identifying violations, match evidence to these official policy statements:

EXTORTION: Per Airbnb's Reviews Policy: "Members of the Airbnb community may not coerce, intimidate, extort, threaten, incentivize or manipulate another person in an attempt to influence a review, like promising compensation in exchange for a positive review or threatening consequences in the event of a negative review."

Also: "Reviews may not be provided or withheld in exchange for something of value—like a discount, refund, reciprocal review, or promise not to take negative action against the reviewer."

RETALIATION: Per Airbnb's Reviews Policy: "Guests should not write biased or inauthentic reviews as a form of retaliation against a host who enforces a policy or rule."

THIRD-PARTY: Per Airbnb's Reviews Policy: "Reviews may only be provided in connection with a genuine stay or experience."

IRRELEVANT: Per Airbnb's Reviews Policy: "Reviews must provide relevant information about the reviewer's experience with the host, guest, stay, or experience that would help other community members make informed booking and hosting decisions." Also: "If a guest never arrived for their stay or experience, or had to cancel due to circumstances unrelated to that stay or experience, their review may be removed."

CONTENT POLICY: Per Airbnb's Content Policy: Reviews may not contain "content that endorses or promotes illegal or harmful activity, or that is sexually explicit, violent, graphic, threatening, or harassing" or "content that includes another person's private information."

## Analysis Categories

1. Policy-Violating Financial Inducement (Extortion): Identify any instance where a guest mentions a financial outcome (refunds, discounts, extra services) in connection with their feedback or review status. Document these as potential violations of the Extortion Policy.

2. Conflict of Interest (Retaliatory): Identify if the review was submitted following the host's enforcement of House Rules (e.g., smoking, unauthorized guests, noise) or the filing of a reimbursement claim. Document the timeline to establish a retaliatory pattern.

3. Inauthentic/Irrelevant (Third-Party): Identify if the guest indicates they were not the primary person experiencing the stay (e.g., booking for others). Flag references to issues outside the host's control (e.g., local infrastructure, weather).

4. Evidence Extraction: Extract and quote the exact snippets from the message history that provide the strongest evidence for these violations. These quotes will be used to provide factual documentation to Airbnb Support agents.

For each red flag identified, cite which specific Airbnb policy clause it violates.

Be thorough but only flag genuine policy violations with supporting evidence. If there are no clear violations, report that honestly.`;

interface PromptConfig {
  id?: string;
  prompt_key: string;
  prompt_name: string;
  system_prompt: string;
}

export function AIPromptsSettings() {
  const { role, organizationId } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("call_prep");
  
  const [callPrepConfig, setCallPrepConfig] = useState<PromptConfig | null>(null);
  const [callPrepPrompt, setCallPrepPrompt] = useState(DEFAULT_CALL_PREP_PROMPT);
  
  const [revenueActionsConfig, setRevenueActionsConfig] = useState<PromptConfig | null>(null);
  const [revenueActionsPrompt, setRevenueActionsPrompt] = useState(DEFAULT_REVENUE_ACTIONS_PROMPT);
  
  const [reviewDisputeConfig, setReviewDisputeConfig] = useState<PromptConfig | null>(null);
  const [reviewDisputePrompt, setReviewDisputePrompt] = useState(DEFAULT_REVIEW_DISPUTE_PROMPT);
  
  const [conversationRedFlagsConfig, setConversationRedFlagsConfig] = useState<PromptConfig | null>(null);
  const [conversationRedFlagsPrompt, setConversationRedFlagsPrompt] = useState(DEFAULT_CONVERSATION_REDFLAGS_PROMPT);
  
  const { toast } = useToast();

  const isAdmin = role === 'super_admin' || role === 'admin';

  useEffect(() => {
    if (organizationId) {
      loadPromptConfigs();
    }
  }, [organizationId]);

  const loadPromptConfigs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ai_prompt_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .in('prompt_key', ['call_prep', 'revenue_actions', 'review_dispute_analysis', 'conversation_redflags_analysis']);

      if (error) throw error;

      if (data) {
        const callPrep = data.find(p => p.prompt_key === 'call_prep');
        const revenueActions = data.find(p => p.prompt_key === 'revenue_actions');
        const reviewDispute = data.find(p => p.prompt_key === 'review_dispute_analysis');
        const conversationRedFlags = data.find(p => p.prompt_key === 'conversation_redflags_analysis');
        
        if (callPrep) {
          setCallPrepConfig(callPrep);
          setCallPrepPrompt(callPrep.system_prompt);
        }
        
        if (revenueActions) {
          setRevenueActionsConfig(revenueActions);
          setRevenueActionsPrompt(revenueActions.system_prompt);
        }
        
        if (reviewDispute) {
          setReviewDisputeConfig(reviewDispute);
          setReviewDisputePrompt(reviewDispute.system_prompt);
        }
        
        if (conversationRedFlags) {
          setConversationRedFlagsConfig(conversationRedFlags);
          setConversationRedFlagsPrompt(conversationRedFlags.system_prompt);
        }
      }
    } catch (error: any) {
      console.error('Error loading prompt configs:', error);
      toast({
        title: "Error loading AI prompt configuration",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (promptKey: 'call_prep' | 'revenue_actions' | 'review_dispute_analysis' | 'conversation_redflags_analysis') => {
    if (!organizationId) return;
    
    const isCallPrep = promptKey === 'call_prep';
    const isRevenueActions = promptKey === 'revenue_actions';
    const isConversationRedFlags = promptKey === 'conversation_redflags_analysis';
    
    let config: PromptConfig | null;
    let prompt: string;
    let promptName: string;
    
    if (isCallPrep) {
      config = callPrepConfig;
      prompt = callPrepPrompt;
      promptName = 'Owner Call Prep';
    } else if (isRevenueActions) {
      config = revenueActionsConfig;
      prompt = revenueActionsPrompt;
      promptName = 'Revenue Manager Actions';
    } else if (isConversationRedFlags) {
      config = conversationRedFlagsConfig;
      prompt = conversationRedFlagsPrompt;
      promptName = 'Conversation Red Flags Analysis';
    } else {
      config = reviewDisputeConfig;
      prompt = reviewDisputePrompt;
      promptName = 'Review Dispute Analysis';
    }
    
    try {
      setSaving(true);

      if (config?.id) {
        const { error } = await supabase
          .from('ai_prompt_configs')
          .update({
            system_prompt: prompt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', config.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('ai_prompt_configs')
          .insert({
            organization_id: organizationId,
            prompt_key: promptKey,
            prompt_name: promptName,
            system_prompt: prompt,
          })
          .select()
          .single();

        if (error) throw error;
        
        if (isCallPrep) {
          setCallPrepConfig(data);
        } else if (isRevenueActions) {
          setRevenueActionsConfig(data);
        } else if (isConversationRedFlags) {
          setConversationRedFlagsConfig(data);
        } else {
          setReviewDisputeConfig(data);
        }
      }

      toast({
        title: "AI prompt saved",
        description: "Your changes have been saved successfully.",
      });
    } catch (error: any) {
      console.error('Error saving prompt config:', error);
      toast({
        title: "Error saving AI prompt",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = (promptKey: 'call_prep' | 'revenue_actions' | 'review_dispute_analysis' | 'conversation_redflags_analysis') => {
    if (promptKey === 'call_prep') {
      setCallPrepPrompt(DEFAULT_CALL_PREP_PROMPT);
    } else if (promptKey === 'revenue_actions') {
      setRevenueActionsPrompt(DEFAULT_REVENUE_ACTIONS_PROMPT);
    } else if (promptKey === 'conversation_redflags_analysis') {
      setConversationRedFlagsPrompt(DEFAULT_CONVERSATION_REDFLAGS_PROMPT);
    } else {
      setReviewDisputePrompt(DEFAULT_REVIEW_DISPUTE_PROMPT);
    }
    toast({
      title: "Prompt reset",
      description: "The prompt has been reset to default. Click Save to apply.",
    });
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Prompts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Prompts
        </CardTitle>
        <CardDescription>
          Configure the AI system prompts used for generating content
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="call_prep">Call Prep</TabsTrigger>
            <TabsTrigger value="revenue_actions">Revenue Actions</TabsTrigger>
            <TabsTrigger value="review_dispute">Review Disputes</TabsTrigger>
            <TabsTrigger value="conversation_redflags">Red Flags</TabsTrigger>
          </TabsList>
          
          <TabsContent value="call_prep" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="call-prep-prompt" className="text-base font-medium">
                  Owner Call Prep Prompt
                </Label>
                <Button variant="outline" size="sm" onClick={() => handleReset('call_prep')}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Default
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                This prompt instructs the AI how to generate talking points for owner calls. 
                It receives property data, goals, forecasts, reviews, and market comparisons.
              </p>
              <Textarea
                id="call-prep-prompt"
                value={callPrepPrompt}
                onChange={(e) => setCallPrepPrompt(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="Enter the system prompt for the AI..."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => handleSave('call_prep')} disabled={saving}>
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
          
          <TabsContent value="revenue_actions" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="revenue-actions-prompt" className="text-base font-medium">
                  Revenue Manager Actions Prompt
                </Label>
                <Button variant="outline" size="sm" onClick={() => handleReset('revenue_actions')}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Default
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                This prompt instructs the AI how to generate revenue management action items. 
                It receives calendar data, pricing, gaps, min nights, pacing, and comp analysis.
              </p>
              <Textarea
                id="revenue-actions-prompt"
                value={revenueActionsPrompt}
                onChange={(e) => setRevenueActionsPrompt(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="Enter the system prompt for the AI..."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => handleSave('revenue_actions')} disabled={saving}>
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
          
          <TabsContent value="review_dispute" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="review-dispute-prompt" className="text-base font-medium">
                  Review Dispute Analysis Prompt
                </Label>
                <Button variant="outline" size="sm" onClick={() => handleReset('review_dispute_analysis')}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Default
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                This prompt instructs the AI how to analyze negative Airbnb reviews for dispute eligibility.
                It receives the review text, ratings, guest-host conversation history, and reservation details.
              </p>
              <Textarea
                id="review-dispute-prompt"
                value={reviewDisputePrompt}
                onChange={(e) => setReviewDisputePrompt(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="Enter the system prompt for the AI..."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => handleSave('review_dispute_analysis')} disabled={saving}>
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
        </Tabs>
      </CardContent>
    </Card>
  );
}
