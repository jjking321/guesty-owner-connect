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
        .in('prompt_key', ['call_prep', 'revenue_actions']);

      if (error) throw error;

      if (data) {
        const callPrep = data.find(p => p.prompt_key === 'call_prep');
        const revenueActions = data.find(p => p.prompt_key === 'revenue_actions');
        
        if (callPrep) {
          setCallPrepConfig(callPrep);
          setCallPrepPrompt(callPrep.system_prompt);
        }
        
        if (revenueActions) {
          setRevenueActionsConfig(revenueActions);
          setRevenueActionsPrompt(revenueActions.system_prompt);
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

  const handleSave = async (promptKey: 'call_prep' | 'revenue_actions') => {
    if (!organizationId) return;
    
    const isCallPrep = promptKey === 'call_prep';
    const config = isCallPrep ? callPrepConfig : revenueActionsConfig;
    const prompt = isCallPrep ? callPrepPrompt : revenueActionsPrompt;
    const promptName = isCallPrep ? 'Owner Call Prep' : 'Revenue Manager Actions';
    
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
        } else {
          setRevenueActionsConfig(data);
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

  const handleReset = (promptKey: 'call_prep' | 'revenue_actions') => {
    if (promptKey === 'call_prep') {
      setCallPrepPrompt(DEFAULT_CALL_PREP_PROMPT);
    } else {
      setRevenueActionsPrompt(DEFAULT_REVENUE_ACTIONS_PROMPT);
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
        </Tabs>
      </CardContent>
    </Card>
  );
}
