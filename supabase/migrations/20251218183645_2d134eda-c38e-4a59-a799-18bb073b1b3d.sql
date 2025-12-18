-- Create ai_prompt_configs table for storing admin-configurable AI prompts
CREATE TABLE public.ai_prompt_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  prompt_key text NOT NULL,
  prompt_name text NOT NULL,
  system_prompt text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(organization_id, prompt_key)
);

-- Enable RLS
ALTER TABLE public.ai_prompt_configs ENABLE ROW LEVEL SECURITY;

-- Policy: Organization members can view prompts
CREATE POLICY "Organization members can view prompts"
ON public.ai_prompt_configs
FOR SELECT
USING (is_organization_member(organization_id, auth.uid()));

-- Policy: Only super_admin and admin can update prompts
CREATE POLICY "Admins can update prompts"
ON public.ai_prompt_configs
FOR UPDATE
USING (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR 
  has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);

-- Policy: Only super_admin and admin can insert prompts
CREATE POLICY "Admins can insert prompts"
ON public.ai_prompt_configs
FOR INSERT
WITH CHECK (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR 
  has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);

-- Policy: Only super_admin and admin can delete prompts
CREATE POLICY "Admins can delete prompts"
ON public.ai_prompt_configs
FOR DELETE
USING (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR 
  has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);

-- Create trigger for updated_at
CREATE TRIGGER update_ai_prompt_configs_updated_at
BEFORE UPDATE ON public.ai_prompt_configs
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Insert default call_prep prompt for all existing organizations
INSERT INTO public.ai_prompt_configs (organization_id, prompt_key, prompt_name, system_prompt)
SELECT 
  id as organization_id,
  'call_prep' as prompt_key,
  'Owner Call Prep' as prompt_name,
  'You are an expert owner relations consultant for a vacation rental management company. Your job is to prepare talking points for a call with a property owner.

Analyze the provided data and generate a concise, actionable call prep document with the following sections:

## Performance Summary
A 2-3 sentence overview of how the property is performing.

## Key Wins
- Bullet points highlighting positive performance metrics, recent wins, or good trends (3-5 items)

## Areas of Concern
- Bullet points noting any issues, declining metrics, or areas needing attention (2-4 items, or "None" if property is performing well)

## Goals & Pacing
How the property is tracking against its goals. Include specific numbers.

## Market Position
How this property compares to similar properties in the market based on compset data.

## Suggested Talking Points
- Specific topics to discuss with the owner
- Questions to ask
- Recommendations to propose

## Recent Reviews
Highlight any notable guest feedback (positive or negative) that should be discussed.

Keep responses concise and action-oriented. Use specific numbers from the data provided. Do not make up data - only use what is provided.' as system_prompt
FROM public.organizations;