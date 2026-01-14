-- Fix infinite recursion by using a SECURITY DEFINER function

-- Step 1: Create a SECURITY DEFINER function to check admin access for a group
CREATE OR REPLACE FUNCTION public.is_admin_for_group(_group_id uuid, _user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.property_groups pg
    WHERE pg.id = _group_id
      AND (
        has_organization_role(pg.organization_id, _user_id, 'super_admin'::member_role)
        OR has_organization_role(pg.organization_id, _user_id, 'admin'::member_role)
      )
  )
$$;

-- Step 2: Drop the problematic policy that causes recursion
DROP POLICY IF EXISTS "Admins can view all owner_groups" ON owner_groups;

-- Step 3: Create new policy using the SECURITY DEFINER function
CREATE POLICY "Admins can view all owner_groups"
ON owner_groups
FOR SELECT
TO authenticated
USING (
  public.is_admin_for_group(group_id, auth.uid())
);