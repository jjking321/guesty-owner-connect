
-- Create listing_tax_settings table
CREATE TABLE public.listing_tax_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text UNIQUE NOT NULL,
  permit_number text,
  property_address text,
  behalf_platforms text[] DEFAULT '{}',
  organization_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.listing_tax_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: org members can view
CREATE POLICY "Org members can view tax settings"
ON public.listing_tax_settings
FOR SELECT
USING (is_organization_member(organization_id, auth.uid()));

-- INSERT: org members can insert
CREATE POLICY "Org members can insert tax settings"
ON public.listing_tax_settings
FOR INSERT
WITH CHECK (is_organization_member(organization_id, auth.uid()));

-- UPDATE: org members can update
CREATE POLICY "Org members can update tax settings"
ON public.listing_tax_settings
FOR UPDATE
USING (is_organization_member(organization_id, auth.uid()));

-- DELETE: admins can delete
CREATE POLICY "Admins can delete tax settings"
ON public.listing_tax_settings
FOR DELETE
USING (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
  OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);

-- updated_at trigger
CREATE TRIGGER update_listing_tax_settings_updated_at
BEFORE UPDATE ON public.listing_tax_settings
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
