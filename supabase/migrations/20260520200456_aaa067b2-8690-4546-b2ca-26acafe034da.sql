CREATE POLICY "Org co-members can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members om_self
    JOIN public.organization_members om_other
      ON om_self.organization_id = om_other.organization_id
    WHERE om_self.user_id = auth.uid()
      AND om_other.user_id = profiles.id
  )
);