
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_organization_id uuid;

CREATE OR REPLACE FUNCTION public.is_organization_member(_organization_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _organization_id AND user_id = _user_id
  )
  AND COALESCE(
    (SELECT active_organization_id FROM public.profiles WHERE id = _user_id),
    _organization_id
  ) = _organization_id
$$;

CREATE OR REPLACE FUNCTION public.has_organization_role(_organization_id uuid, _user_id uuid, _role member_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _organization_id AND user_id = _user_id AND role = _role
  )
  AND COALESCE(
    (SELECT active_organization_id FROM public.profiles WHERE id = _user_id),
    _organization_id
  ) = _organization_id
$$;

CREATE OR REPLACE FUNCTION public.get_accessible_organizations()
RETURNS TABLE(id uuid, name text, role member_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name,
    COALESCE(
      (SELECT om.role FROM public.organization_members om
        WHERE om.organization_id = o.id AND om.user_id = auth.uid() LIMIT 1),
      'super_admin'::member_role
    ) AS role
  FROM public.organizations o
  WHERE EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = o.id AND user_id = auth.uid()
  )
  OR public.is_super_admin_anywhere(auth.uid())
  ORDER BY o.name;
$$;
