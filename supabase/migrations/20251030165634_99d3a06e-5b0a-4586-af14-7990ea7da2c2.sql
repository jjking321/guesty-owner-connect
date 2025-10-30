-- Fix infinite recursion by removing SELECT from admin policy on owner_groups
-- 1) Drop existing policy that applies to ALL (including SELECT)
DROP POLICY IF EXISTS "Admins can manage owner_groups" ON public.owner_groups;

-- 2) Recreate admin policies for non-SELECT operations only
CREATE POLICY "Admins can insert owner_groups"
ON public.owner_groups
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.property_groups pg
    WHERE pg.id = owner_groups.group_id
      AND (
        has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role)
        OR has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
);

CREATE POLICY "Admins can update owner_groups"
ON public.owner_groups
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.property_groups pg
    WHERE pg.id = owner_groups.group_id
      AND (
        has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role)
        OR has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.property_groups pg
    WHERE pg.id = owner_groups.group_id
      AND (
        has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role)
        OR has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
);

CREATE POLICY "Admins can delete owner_groups"
ON public.owner_groups
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.property_groups pg
    WHERE pg.id = owner_groups.group_id
      AND (
        has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role)
        OR has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
);

-- Note: SELECT on owner_groups remains restricted to owners via existing policy:
--   "Owners can view their assigned groups" USING (owner_id = get_user_owner_id(auth.uid()))
-- This avoids recursion while property_groups SELECT uses org membership.
