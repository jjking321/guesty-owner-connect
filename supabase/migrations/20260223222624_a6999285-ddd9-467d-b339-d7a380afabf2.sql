
CREATE TABLE public.organization_tax_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL,
  behalf_platforms text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.organization_tax_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view tax settings"
  ON public.organization_tax_settings FOR SELECT
  USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Admins can insert tax settings"
  ON public.organization_tax_settings FOR INSERT
  WITH CHECK (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

CREATE POLICY "Admins can update tax settings"
  ON public.organization_tax_settings FOR UPDATE
  USING (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

-- Seed from existing data
INSERT INTO public.organization_tax_settings (organization_id, behalf_platforms)
SELECT DISTINCT organization_id, behalf_platforms
FROM public.listing_tax_settings
WHERE behalf_platforms IS NOT NULL AND behalf_platforms != '{}'
ON CONFLICT (organization_id) DO NOTHING;
