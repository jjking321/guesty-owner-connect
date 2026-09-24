-- Returns the prevailing minimum-night requirement per listing, derived from
-- the forward calendar. Used to group portfolio peers into stay tiers
-- (short-term vs weekly/mid-term vs monthly).
CREATE OR REPLACE FUNCTION public.get_listing_stay_profiles(p_listing_ids TEXT[] DEFAULT NULL)
RETURNS TABLE (
  listing_id TEXT,
  typical_min_nights NUMERIC,
  max_min_nights INTEGER,
  min_min_nights INTEGER,
  days_sampled INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cc.listing_id,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY cc.min_nights)::numeric AS typical_min_nights,
    MAX(cc.min_nights)::int AS max_min_nights,
    MIN(cc.min_nights)::int AS min_min_nights,
    COUNT(*)::int AS days_sampled
  FROM public.capacity_calendar cc
  JOIN public.listings l ON l.id = cc.listing_id
  JOIN public.guesty_accounts ga ON ga.id = l.guesty_account_id
  WHERE cc.min_nights IS NOT NULL
    AND cc.date >= CURRENT_DATE
    AND cc.date < CURRENT_DATE + INTERVAL '180 days'
    AND (p_listing_ids IS NULL OR cc.listing_id = ANY(p_listing_ids))
    AND public.is_organization_member(ga.organization_id, auth.uid())
  GROUP BY cc.listing_id
$$;

REVOKE ALL ON FUNCTION public.get_listing_stay_profiles(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_listing_stay_profiles(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_listing_stay_profiles(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_listing_stay_profiles(TEXT[]) TO service_role;