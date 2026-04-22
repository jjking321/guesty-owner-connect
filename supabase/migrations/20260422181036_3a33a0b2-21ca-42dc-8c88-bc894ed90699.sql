-- Create custom_reports table for the Custom Reports Builder
CREATE TABLE public.custom_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_template BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{"modules":[]}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;

-- Shared with whole organization: any org member can do anything
CREATE POLICY "Org members can view custom reports"
ON public.custom_reports
FOR SELECT
USING (public.is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Org members can insert custom reports"
ON public.custom_reports
FOR INSERT
WITH CHECK (public.is_organization_member(organization_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Org members can update custom reports"
ON public.custom_reports
FOR UPDATE
USING (public.is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Org members can delete custom reports"
ON public.custom_reports
FOR DELETE
USING (public.is_organization_member(organization_id, auth.uid()));

-- Indexes for common lookups
CREATE INDEX idx_custom_reports_org ON public.custom_reports(organization_id);
CREATE INDEX idx_custom_reports_template ON public.custom_reports(organization_id, is_template);

-- Auto-update updated_at
CREATE TRIGGER update_custom_reports_updated_at
BEFORE UPDATE ON public.custom_reports
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();