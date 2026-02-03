-- Fix the overly permissive policy for service role
DROP POLICY IF EXISTS "Service role can manage actionables" ON property_actionables;

-- Add INSERT policy for organization members (edge function runs with service role which bypasses RLS anyway)
CREATE POLICY "Users can insert org actionables" ON property_actionables
  FOR INSERT WITH CHECK (is_organization_member(organization_id, auth.uid()));

-- Add DELETE policy for organization members
CREATE POLICY "Users can delete org actionables" ON property_actionables
  FOR DELETE USING (is_organization_member(organization_id, auth.uid()));