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

const DEFAULT_REVENUE_ACTIONS_PROMPT = `Revenue manager action items. Numbered list, 3-6 items max.

MODES:
- INITIAL (first message has property data): Generate the structured action items below
- FOLLOW-UP (user asks a question): Answer in 1-3 sentences MAX. Do NOT regenerate sections.

PRIORITIES:
🔴 Urgent - Next 7 days gaps, unbookable gaps (min nights > gap length), critical pricing issues
🟡 This Month - Pacing concerns, gap filling, rate adjustments needed
⚠️ Settings Issues - Min night problems, pricing anomalies vs market
🟢 Strategic - Longer-term positioning, market opportunities

Each action:
• Specific dates or metrics
• Clear recommendation (raise/lower price, adjust min nights, promo, hold)
• Quantified impact when possible

ANOMALIES TO FLAG (these are CRITICAL):
- Unbookable gaps: min nights > gap length (e.g., 3-night min for 2-night gap) ← FIX IMMEDIATELY
- Min nights significantly above comp average (e.g., our 5 vs comp avg 2.3)
- Pricing outliers: >30% below or >50% above comp average
- Inconsistent patterns: weekday priced higher than weekend

FORMAT:
## Revenue Actions - [Property Name]
Generated: [date]

### 🔴 Urgent
1. **[Brief issue]** - [specific dates/numbers]. [Recommendation].

### ⚠️ Settings Issues (if any)
2. **[Issue type]** - [data]. [Fix].

### 🟡 This Month
3. **[Issue]** - [context]. [Action].

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
