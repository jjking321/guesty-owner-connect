import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Save, RotateCcw, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";

const DEFAULT_CALL_PREP_PROMPT = `You are an owner relations assistant. Generate quick-scan call prep notes - NOT polished paragraphs.

RESPONSE MODE:
- INITIAL request (property data, no prior conversation): Generate structured notes below
- FOLLOW-UP questions: Answer directly and briefly. Do NOT regenerate the report.

TONE: Positive-first, celebratory. Short fragments, not full sentences. Numbers over words.

=== FORMAT ===

## Quick Summary
1-2 lines max. The headline.

## Wins 🎉
• [metric] - [number/context]
(4-6 quick hits, specific numbers)

## Watch List (internal - don't bring up)
• [issue] - [brief context]
(1-3 items or "All good")

## Goals
• Budget: $X / $Y (X%)
• Goal: $X / $Y (X%)
• Pacing: ahead/behind/on track

## vs Market
• [competitive advantage]
• [market position point]

## Talk About
• [topic] - [why mention it]
• [question to ask owner]

## Recent Feedback
• [date] [rating]★ - [1-line takeaway]

=== END FORMAT ===

Be specific. Use the data. No fluff. Fragments over sentences.`;

export function AIPromptsSettings() {
  const { role, organizationId } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promptConfig, setPromptConfig] = useState<any>(null);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_CALL_PREP_PROMPT);
  const { toast } = useToast();

  const isAdmin = role === 'super_admin' || role === 'admin';

  useEffect(() => {
    if (organizationId) {
      loadPromptConfig();
    }
  }, [organizationId]);

  const loadPromptConfig = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ai_prompt_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('prompt_key', 'call_prep')
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPromptConfig(data);
        setSystemPrompt(data.system_prompt);
      }
    } catch (error: any) {
      console.error('Error loading prompt config:', error);
      toast({
        title: "Error loading AI prompt configuration",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!organizationId) return;
    
    try {
      setSaving(true);

      if (promptConfig) {
        // Update existing config
        const { error } = await supabase
          .from('ai_prompt_configs')
          .update({
            system_prompt: systemPrompt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', promptConfig.id);

        if (error) throw error;
      } else {
        // Insert new config
        const { data, error } = await supabase
          .from('ai_prompt_configs')
          .insert({
            organization_id: organizationId,
            prompt_key: 'call_prep',
            prompt_name: 'Owner Call Prep',
            system_prompt: systemPrompt,
          })
          .select()
          .single();

        if (error) throw error;
        setPromptConfig(data);
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

  const handleReset = () => {
    setSystemPrompt(DEFAULT_CALL_PREP_PROMPT);
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
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="call-prep-prompt" className="text-base font-medium">
              Owner Call Prep Prompt
            </Label>
            <Button variant="outline" size="sm" onClick={handleReset}>
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
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
            placeholder="Enter the system prompt for the AI..."
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
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
      </CardContent>
    </Card>
  );
}
