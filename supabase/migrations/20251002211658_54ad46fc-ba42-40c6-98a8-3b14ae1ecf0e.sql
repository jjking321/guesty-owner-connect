-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view own groups" ON property_groups;
DROP POLICY IF EXISTS "Users can insert own groups" ON property_groups;
DROP POLICY IF EXISTS "Users can update own groups" ON property_groups;
DROP POLICY IF EXISTS "Users can delete own groups" ON property_groups;

-- Create security definer function to check group ownership (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_group_owner(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.property_groups
    WHERE id = _group_id
      AND user_id = _user_id
  )
$$;

-- Create security definer function to check parent group ownership
CREATE OR REPLACE FUNCTION public.is_parent_group_owner(_parent_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.property_groups
    WHERE id = _parent_group_id
      AND user_id = _user_id
  )
$$;

-- Recreate policies using security definer functions
CREATE POLICY "Users can view own groups" ON property_groups
FOR SELECT USING (
  auth.uid() = user_id OR
  (parent_group_id IS NOT NULL AND public.is_parent_group_owner(parent_group_id, auth.uid()))
);

CREATE POLICY "Users can insert own groups" ON property_groups
FOR INSERT WITH CHECK (
  auth.uid() = user_id AND (
    parent_group_id IS NULL OR
    public.is_parent_group_owner(parent_group_id, auth.uid())
  )
);

CREATE POLICY "Users can update own groups" ON property_groups
FOR UPDATE USING (
  auth.uid() = user_id OR
  (parent_group_id IS NOT NULL AND public.is_parent_group_owner(parent_group_id, auth.uid()))
);

CREATE POLICY "Users can delete own groups" ON property_groups
FOR DELETE USING (
  auth.uid() = user_id OR
  (parent_group_id IS NOT NULL AND public.is_parent_group_owner(parent_group_id, auth.uid()))
);