
-- Fix RLS policies with USING(true)/WITH CHECK(true)

-- Service role bypasses RLS; these permissive policies are redundant and flagged by linter
DROP POLICY IF EXISTS "Service role has full access to nightly_sync_runs" ON public.nightly_sync_runs;
DROP POLICY IF EXISTS "Service role has full access" ON public.dispute_analysis_progress;

-- Restrict organization insert to authenticated users only
DROP POLICY IF EXISTS "Users can insert organizations and become owner" ON public.organizations;
CREATE POLICY "Authenticated users can insert organizations"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Revoke EXECUTE on SECURITY DEFINER functions from anon (and PUBLIC).
-- These functions are only used by authenticated flows (RLS helpers + authenticated RPCs);
-- anonymous callers must not be able to invoke them.
REVOKE EXECUTE ON FUNCTION public.is_organization_member(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_organization_role(uuid, uuid, public.member_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin_anywhere(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_group_owner(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_parent_group_owner(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_for_group(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner_listing(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_listing_in_owner_groups(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_owner_id(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_accessible_organizations() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_sync_job(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_portfolio_night_metrics(integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_review_summary_stats(text, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_rating_trend(text, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_distributed_revenue(text, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_composite_nights_for_listing(text, date, date) FROM anon, PUBLIC;

-- Revoke EXECUTE from authenticated on functions that are called only by
-- backend/service-role code paths (edge functions run as service_role which
-- bypasses these grants). Helper functions used inside RLS policies must
-- remain executable by authenticated so policies keep evaluating.
REVOKE EXECUTE ON FUNCTION public.cancel_sync_job(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_portfolio_night_metrics(integer, integer) FROM authenticated;
