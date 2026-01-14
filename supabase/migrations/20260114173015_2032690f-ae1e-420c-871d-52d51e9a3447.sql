-- Add SELECT policy for admins on owner_groups table
-- Using correct argument order: _organization_id, _user_id, _role
CREATE POLICY "Admins can view all owner_groups"
ON owner_groups
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM property_groups pg
    WHERE pg.id = owner_groups.group_id
      AND (
        public.has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role)
        OR public.has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
);