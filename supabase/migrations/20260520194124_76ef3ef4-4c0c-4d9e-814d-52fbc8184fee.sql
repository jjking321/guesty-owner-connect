CREATE OR REPLACE FUNCTION public.is_super_admin_anywhere(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.get_accessible_organizations()
RETURNS TABLE(id uuid, name text, role member_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id, o.name,
    COALESCE(
      (SELECT om.role FROM organization_members om WHERE om.organization_id = o.id AND om.user_id = auth.uid() LIMIT 1),
      'super_admin'::member_role
    ) as role
  FROM organizations o
  WHERE is_organization_member(o.id, auth.uid())
     OR is_super_admin_anywhere(auth.uid())
  ORDER BY o.name;
$$;