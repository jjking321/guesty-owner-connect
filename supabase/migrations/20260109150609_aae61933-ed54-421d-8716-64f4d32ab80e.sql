-- Create compset_templates table for saving and reusing comparable sets
CREATE TABLE public.compset_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  guesty_account_id uuid NOT NULL REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  airroi_listing_ids text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.compset_templates ENABLE ROW LEVEL SECURITY;

-- Users can view templates in their organizations
CREATE POLICY "Users can view templates in their organizations"
ON public.compset_templates
FOR SELECT
USING (
  guesty_account_id IN (
    SELECT ga.id FROM guesty_accounts ga
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- Users can insert templates in their organizations
CREATE POLICY "Users can insert templates in their organizations"
ON public.compset_templates
FOR INSERT
WITH CHECK (
  guesty_account_id IN (
    SELECT ga.id FROM guesty_accounts ga
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- Users can update templates in their organizations
CREATE POLICY "Users can update templates in their organizations"
ON public.compset_templates
FOR UPDATE
USING (
  guesty_account_id IN (
    SELECT ga.id FROM guesty_accounts ga
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- Users can delete templates in their organizations
CREATE POLICY "Users can delete templates in their organizations"
ON public.compset_templates
FOR DELETE
USING (
  guesty_account_id IN (
    SELECT ga.id FROM guesty_accounts ga
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);