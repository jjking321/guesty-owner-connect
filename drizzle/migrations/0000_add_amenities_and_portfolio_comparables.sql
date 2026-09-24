-- 1. Amenities + bathrooms on listings
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bathrooms NUMERIC,
  ADD COLUMN IF NOT EXISTS amenities_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_listings_amenities ON public.listings USING GIN (amenities);

-- 2. Internal portfolio comparables
CREATE TABLE IF NOT EXISTS public.portfolio_comparables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  peer_listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  match_score NUMERIC,
  match_reasons JSONB,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, peer_listing_id),
  CONSTRAINT portfolio_comparables_no_self CHECK (listing_id <> peer_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_comparables_listing ON public.portfolio_comparables(listing_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_comparables_peer ON public.portfolio_comparables(peer_listing_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_comparables TO authenticated;
GRANT ALL ON public.portfolio_comparables TO service_role;

ALTER TABLE public.portfolio_comparables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view portfolio comparables"
ON public.portfolio_comparables FOR SELECT TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Members can insert portfolio comparables"
ON public.portfolio_comparables FOR INSERT TO authenticated
WITH CHECK (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
  AND peer_listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Members can update portfolio comparables"
ON public.portfolio_comparables FOR UPDATE TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Members can delete portfolio comparables"
ON public.portfolio_comparables FOR DELETE TO authenticated
USING (
  listing_id IN (
    SELECT l.id FROM public.listings l
    JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE public.is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE TRIGGER portfolio_comparables_updated_at
BEFORE UPDATE ON public.portfolio_comparables
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Peer performance metrics RPC (TTM realized + forward asking rates, owner reservations excluded)
CREATE OR REPLACE FUNCTION public.get_portfolio_peer_metrics(p_listing_ids TEXT[])
RETURNS TABLE (
  listing_id TEXT,
  ttm_revenue NUMERIC,
  ttm_nights BIGINT,
  ttm_adr NUMERIC,
  ttm_occupancy NUMERIC,
  last30_adr NUMERIC,
  future_asking_adr NUMERIC,
  future_available_nights BIGINT,
  future_booked_nights BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH accessible AS (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE l.id = ANY(p_listing_ids)
      AND is_organization_member(ga.organization_id, auth.uid())
  ),
  ttm AS (
    SELECT rn.listing_id,
           SUM(rn.revenue_allocation) AS revenue,
           COUNT(*) AS nights
    FROM reservation_nights rn
    JOIN reservations r ON r.id = rn.reservation_id
    WHERE rn.listing_id IN (SELECT id FROM accessible)
      AND rn.night_date >= (CURRENT_DATE - INTERVAL '365 days')
      AND rn.night_date < CURRENT_DATE
      AND COALESCE(r.source, '') <> 'owner'
    GROUP BY rn.listing_id
  ),
  last30 AS (
    SELECT rn.listing_id,
           CASE WHEN COUNT(*) > 0 THEN SUM(rn.revenue_allocation) / COUNT(*) END AS adr
    FROM reservation_nights rn
    JOIN reservations r ON r.id = rn.reservation_id
    WHERE rn.listing_id IN (SELECT id FROM accessible)
      AND rn.night_date >= (CURRENT_DATE - INTERVAL '30 days')
      AND rn.night_date < CURRENT_DATE
      AND COALESCE(r.source, '') <> 'owner'
    GROUP BY rn.listing_id
  ),
  fut AS (
    SELECT cc.listing_id,
           AVG(cc.price) FILTER (WHERE cc.is_available AND cc.price > 0) AS asking_adr,
           COUNT(*) FILTER (WHERE cc.is_available) AS available_nights,
           COUNT(*) FILTER (WHERE NOT cc.is_available) AS booked_nights
    FROM capacity_calendar cc
    WHERE cc.listing_id IN (SELECT id FROM accessible)
      AND cc.date >= CURRENT_DATE
      AND cc.date < (CURRENT_DATE + INTERVAL '90 days')
    GROUP BY cc.listing_id
  )
  SELECT a.id,
         COALESCE(t.revenue, 0),
         COALESCE(t.nights, 0),
         CASE WHEN COALESCE(t.nights, 0) > 0 THEN t.revenue / t.nights END,
         CASE WHEN COALESCE(t.nights, 0) > 0 THEN LEAST(100, (t.nights::NUMERIC / 365) * 100) END,
         l30.adr,
         f.asking_adr,
         COALESCE(f.available_nights, 0),
         COALESCE(f.booked_nights, 0)
  FROM accessible a
  LEFT JOIN ttm t ON t.listing_id = a.id
  LEFT JOIN last30 l30 ON l30.listing_id = a.id
  LEFT JOIN fut f ON f.listing_id = a.id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_portfolio_peer_metrics(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_portfolio_peer_metrics(TEXT[]) TO authenticated, service_role;