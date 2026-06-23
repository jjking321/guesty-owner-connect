
-- =========================================================
-- Security fixes: RLS + SECURITY DEFINER execute privileges
-- =========================================================

-- ---- dispute_analysis_progress ----
DROP POLICY IF EXISTS "Authenticated users can view progress" ON public.dispute_analysis_progress;

CREATE POLICY "Users view own dispute progress"
ON public.dispute_analysis_progress
FOR SELECT
TO authenticated
USING (created_by = auth.uid() OR public.is_super_admin_anywhere(auth.uid()));

-- ---- forecast_settings ----
DROP POLICY IF EXISTS "Users can view forecast settings" ON public.forecast_settings;
DROP POLICY IF EXISTS "Users can insert forecast settings" ON public.forecast_settings;
DROP POLICY IF EXISTS "Users can update forecast settings" ON public.forecast_settings;

CREATE POLICY "Org members view forecast settings"
ON public.forecast_settings
FOR SELECT
TO authenticated
USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Org admins insert forecast settings"
ON public.forecast_settings
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
  )
);

CREATE POLICY "Org admins update forecast settings"
ON public.forecast_settings
FOR UPDATE
TO authenticated
USING (
  organization_id IS NOT NULL
  AND (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
  )
);

-- ---- nightly_sync_runs (super_admin read only; service_role writes) ----
CREATE POLICY "Super admins view nightly sync runs"
ON public.nightly_sync_runs
FOR SELECT
TO authenticated
USING (public.is_super_admin_anywhere(auth.uid()));

-- ---- booking_curves: org-member SELECT via listings->guesty_accounts ----
DROP POLICY IF EXISTS "Users can view booking curves for their listings" ON public.booking_curves;

CREATE POLICY "Org members view booking curves"
ON public.booking_curves
FOR SELECT
TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

-- ---- capacity_calendar ----
DROP POLICY IF EXISTS "Users can view capacity for their listings" ON public.capacity_calendar;

CREATE POLICY "Org members view capacity calendar"
ON public.capacity_calendar
FOR SELECT
TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

-- ---- forecast_accuracy ----
DROP POLICY IF EXISTS "Users can view forecast accuracy for their listings" ON public.forecast_accuracy;

CREATE POLICY "Org members view forecast accuracy"
ON public.forecast_accuracy
FOR SELECT
TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

-- ---- Revoke EXECUTE on internal/trigger SECURITY DEFINER functions ----
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_goal_lock() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_reservation_nights_for_reservation() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_super_admin_to_all_orgs() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_super_admins_to_new_org() FROM anon, authenticated, PUBLIC;
