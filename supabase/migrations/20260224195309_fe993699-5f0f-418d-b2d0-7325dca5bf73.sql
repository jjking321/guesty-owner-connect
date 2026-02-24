
-- Drop and recreate listing_tax_settings policies as PERMISSIVE
DROP POLICY IF EXISTS "Org members can view tax settings" ON listing_tax_settings;
DROP POLICY IF EXISTS "Org members can insert tax settings" ON listing_tax_settings;
DROP POLICY IF EXISTS "Org members can update tax settings" ON listing_tax_settings;
DROP POLICY IF EXISTS "Admins can delete tax settings" ON listing_tax_settings;

CREATE POLICY "Org members can view tax settings"
ON listing_tax_settings FOR SELECT
USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Org members can insert tax settings"
ON listing_tax_settings FOR INSERT
WITH CHECK (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Org members can update tax settings"
ON listing_tax_settings FOR UPDATE
USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Admins can delete tax settings"
ON listing_tax_settings FOR DELETE
USING (has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role));
