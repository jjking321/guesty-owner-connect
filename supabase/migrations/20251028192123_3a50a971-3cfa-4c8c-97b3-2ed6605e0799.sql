-- Step 1: Drop all RLS policies that depend on member_role enum
DROP POLICY IF EXISTS "Organization owners can update their organization" ON public.organizations;
DROP POLICY IF EXISTS "Organization owners and admins can insert members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization owners and admins can update members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization owners and admins can delete members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization owners and admins can insert guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Organization owners and admins can update guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Organization owners can delete guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Organization owners and admins can update groups" ON public.property_groups;
DROP POLICY IF EXISTS "Organization owners and admins can delete groups" ON public.property_groups;
DROP POLICY IF EXISTS "Organization owners and admins can insert invitations" ON public.organization_invitations;
DROP POLICY IF EXISTS "Organization owners and admins can delete invitations" ON public.organization_invitations;

-- Step 2: Drop the function that depends on member_role
DROP FUNCTION IF EXISTS public.has_organization_role(uuid, uuid, member_role);

-- Step 3: Create new enum with super_admin instead of owner
CREATE TYPE public.member_role_new AS ENUM ('super_admin', 'admin', 'member');

-- Step 4: Migrate organization_members table
ALTER TABLE public.organization_members ADD COLUMN role_new public.member_role_new;

UPDATE public.organization_members
SET role_new = CASE 
  WHEN role::text = 'owner' THEN 'super_admin'::member_role_new
  ELSE role::text::member_role_new
END;

ALTER TABLE public.organization_members DROP COLUMN role;
ALTER TABLE public.organization_members RENAME COLUMN role_new TO role;
ALTER TABLE public.organization_members ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.organization_members ALTER COLUMN role SET DEFAULT 'member'::member_role_new;

-- Step 5: Migrate organization_invitations table
ALTER TABLE public.organization_invitations ADD COLUMN role_new public.member_role_new;

UPDATE public.organization_invitations
SET role_new = CASE 
  WHEN role::text = 'owner' THEN 'super_admin'::member_role_new
  ELSE role::text::member_role_new
END;

ALTER TABLE public.organization_invitations DROP COLUMN role;
ALTER TABLE public.organization_invitations RENAME COLUMN role_new TO role;
ALTER TABLE public.organization_invitations ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.organization_invitations ALTER COLUMN role SET DEFAULT 'member'::member_role_new;

-- Step 6: Drop old enum and rename new one
DROP TYPE public.member_role;
ALTER TYPE public.member_role_new RENAME TO member_role;

-- Step 7: Recreate the has_organization_role function with new enum
CREATE OR REPLACE FUNCTION public.has_organization_role(_organization_id uuid, _user_id uuid, _role member_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = _organization_id
      AND user_id = _user_id
      AND role = _role
  )
$$;

-- Step 8: Recreate all RLS policies with super_admin

-- Organizations table
CREATE POLICY "Organization super admins can update their organization"
ON public.organizations
FOR UPDATE
TO authenticated
USING (public.has_organization_role(id, auth.uid(), 'super_admin'));

-- Organization members table
CREATE POLICY "Organization super admins and admins can insert members"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins and admins can update members"
ON public.organization_members
FOR UPDATE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins and admins can delete members"
ON public.organization_members
FOR DELETE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

-- Guesty accounts table
CREATE POLICY "Organization super admins and admins can insert guesty accounts"
ON public.guesty_accounts
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins and admins can update guesty accounts"
ON public.guesty_accounts
FOR UPDATE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins can delete guesty accounts"
ON public.guesty_accounts
FOR DELETE
TO authenticated
USING (public.has_organization_role(organization_id, auth.uid(), 'super_admin'));

-- Property groups table
CREATE POLICY "Organization super admins and admins can update groups"
ON public.property_groups
FOR UPDATE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins and admins can delete groups"
ON public.property_groups
FOR DELETE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

-- Organization invitations table
CREATE POLICY "Organization super admins and admins can insert invitations"
ON public.organization_invitations
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

CREATE POLICY "Organization super admins and admins can delete invitations"
ON public.organization_invitations
FOR DELETE
TO authenticated
USING (
  public.has_organization_role(organization_id, auth.uid(), 'super_admin') OR 
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);