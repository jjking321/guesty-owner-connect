-- 1. Trigger: when a super_admin membership is added, propagate to all other orgs
CREATE OR REPLACE FUNCTION public.sync_super_admin_to_all_orgs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'super_admin' THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    SELECT o.id, NEW.user_id, 'super_admin'::member_role
    FROM public.organizations o
    WHERE o.id <> NEW.organization_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_super_admin_to_all_orgs ON public.organization_members;
CREATE TRIGGER trg_sync_super_admin_to_all_orgs
AFTER INSERT OR UPDATE OF role ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.sync_super_admin_to_all_orgs();

-- 2. Trigger: when a new org is created, add every super admin as super_admin member
CREATE OR REPLACE FUNCTION public.seed_super_admins_to_new_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_members (organization_id, user_id, role)
  SELECT NEW.id, om.user_id, 'super_admin'::member_role
  FROM public.organization_members om
  WHERE om.role = 'super_admin'
  GROUP BY om.user_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_super_admins_to_new_org ON public.organizations;
CREATE TRIGGER trg_seed_super_admins_to_new_org
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_super_admins_to_new_org();

-- 3. Add unique constraint needed for ON CONFLICT to work cleanly
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_org_user_unique'
  ) THEN
    ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_org_user_unique UNIQUE (organization_id, user_id);
  END IF;
END $$;

-- 4. Backfill: every existing super admin becomes a member of every org
INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT o.id, sa.user_id, 'super_admin'::member_role
FROM public.organizations o
CROSS JOIN (
  SELECT DISTINCT user_id FROM public.organization_members WHERE role = 'super_admin'
) sa
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 5. Replace member-management RLS to lock down super_admin role assignment
DROP POLICY IF EXISTS "Organization super admins and admins can insert members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization super admins and admins can update members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization super admins and admins can delete members" ON public.organization_members;

CREATE POLICY "Super admins can insert super_admin members"
ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (role = 'super_admin' AND is_super_admin_anywhere(auth.uid()));

CREATE POLICY "Org admins can insert non-super members"
ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (
  role <> 'super_admin'
  AND (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  )
);

CREATE POLICY "Super admins can update super_admin members"
ON public.organization_members FOR UPDATE TO authenticated
USING (role = 'super_admin' AND is_super_admin_anywhere(auth.uid()))
WITH CHECK (is_super_admin_anywhere(auth.uid()));

CREATE POLICY "Org admins can update non-super members"
ON public.organization_members FOR UPDATE TO authenticated
USING (
  role <> 'super_admin'
  AND (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  )
)
WITH CHECK (
  role <> 'super_admin'
  AND (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  )
);

CREATE POLICY "Super admins can delete super_admin members"
ON public.organization_members FOR DELETE TO authenticated
USING (role = 'super_admin' AND is_super_admin_anywhere(auth.uid()));

CREATE POLICY "Org admins can delete non-super members"
ON public.organization_members FOR DELETE TO authenticated
USING (
  role <> 'super_admin'
  AND (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  )
);

-- 6. Same split for invitations
DROP POLICY IF EXISTS "Organization super admins and admins can insert invitations" ON public.organization_invitations;
DROP POLICY IF EXISTS "Organization super admins and admins can delete invitations" ON public.organization_invitations;

CREATE POLICY "Super admins can invite super_admins"
ON public.organization_invitations FOR INSERT TO authenticated
WITH CHECK (role = 'super_admin' AND is_super_admin_anywhere(auth.uid()));

CREATE POLICY "Org admins can invite non-super members"
ON public.organization_invitations FOR INSERT TO authenticated
WITH CHECK (
  role <> 'super_admin'
  AND (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  )
);

CREATE POLICY "Org admins can delete invitations"
ON public.organization_invitations FOR DELETE TO authenticated
USING (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
  OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);