
-- Create tax_groups table
CREATE TABLE public.tax_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  permit_number text,
  property_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tax_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Org members can view tax groups"
ON public.tax_groups FOR SELECT
USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Admins can insert tax groups"
ON public.tax_groups FOR INSERT
WITH CHECK (has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role));

CREATE POLICY "Admins can update tax groups"
ON public.tax_groups FOR UPDATE
USING (has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role));

CREATE POLICY "Admins can delete tax groups"
ON public.tax_groups FOR DELETE
USING (has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role));

-- Add tax_group_id to listing_tax_settings
ALTER TABLE public.listing_tax_settings
ADD COLUMN tax_group_id uuid REFERENCES public.tax_groups(id) ON DELETE SET NULL;
