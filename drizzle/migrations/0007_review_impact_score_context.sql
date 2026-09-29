CREATE INDEX IF NOT EXISTS idx_reviews_listing_date_rating
  ON public.reviews (listing_id, review_date) INCLUDE (rating, source, is_removed);

COMMENT ON FUNCTION public.get_review_impact_events(date, date, numeric, integer, text) IS 'DEPRECATED: replaced by get_review_impact_events_v2 (adds score_before/score_after/reviews_before)';

CREATE OR REPLACE FUNCTION public.get_review_impact_events_v2(p_start_date date, p_end_date date, p_max_rating numeric DEFAULT 4, p_window_days integer DEFAULT 30, p_source text DEFAULT 'Airbnb')
RETURNS TABLE(
  review_id text, listing_id text, listing_name text, review_date timestamptz, rating numeric, source text,
  review_snippet text, is_removed boolean, peer_count integer, post_complete boolean,
  score_before numeric, score_after numeric, reviews_before integer,
  pre_bookings bigint, pre_nights bigint, pre_revenue numeric,
  post_bookings bigint, post_nights bigint, post_revenue numeric,
  hist_pre_bookings bigint, hist_pre_nights bigint, hist_pre_revenue numeric,
  hist_post_bookings bigint, hist_post_nights bigint, hist_post_revenue numeric,
  peer_pre_bookings bigint, peer_pre_nights bigint, peer_pre_revenue numeric,
  peer_post_bookings bigint, peer_post_nights bigint, peer_post_revenue numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT rv.id, rv.listing_id, l.nickname, rv.review_date, rv.rating, rv.source,
           left(coalesce(rv.review_text,''), 240) AS snippet, rv.is_removed,
           coalesce((SELECT array_agg(pc.peer_listing_id) FROM portfolio_comparables pc WHERE pc.listing_id = rv.listing_id), '{}'::text[]) AS peers
    FROM reviews rv
    JOIN listings l ON l.id = rv.listing_id
    JOIN guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE is_organization_member(ga.organization_id, auth.uid())
      AND rv.source ILIKE p_source
      AND rv.rating IS NOT NULL AND rv.rating <= p_max_rating
      AND rv.review_date >= p_start_date AND rv.review_date < (p_end_date + 1)
  )
  SELECT ev.id, ev.listing_id, ev.nickname, ev.review_date, ev.rating, ev.source, ev.snippet, ev.is_removed,
         cardinality(ev.peers), (ev.review_date + make_interval(days => p_window_days)) <= now(),
         h.score_before, h.score_after, h.reviews_before,
         a.bookings, a.nights, a.revenue, b.bookings, b.nights, b.revenue,
         c.bookings, c.nights, c.revenue, d.bookings, d.nights, d.revenue,
         e.bookings, e.nights, e.revenue, f.bookings, f.nights, f.revenue
  FROM ev
  CROSS JOIN LATERAL (
    SELECT round(avg(pr.rating) FILTER (WHERE pr.review_date < ev.review_date), 3) AS score_before,
           round(avg(pr.rating) FILTER (WHERE pr.review_date <= ev.review_date), 3) AS score_after,
           count(*) FILTER (WHERE pr.review_date < ev.review_date)::integer AS reviews_before
    FROM reviews pr
    WHERE pr.listing_id = ev.listing_id
      AND pr.source ILIKE p_source
      AND pr.rating IS NOT NULL
      AND pr.is_removed = false
      AND pr.review_date <= ev.review_date
  ) h
  CROSS JOIN LATERAL review_impact_window_stats(ARRAY[ev.listing_id], ev.review_date - make_interval(days => p_window_days), ev.review_date) a
  CROSS JOIN LATERAL review_impact_window_stats(ARRAY[ev.listing_id], ev.review_date, ev.review_date + make_interval(days => p_window_days)) b
  CROSS JOIN LATERAL review_impact_window_stats(ARRAY[ev.listing_id], ev.review_date - interval '1 year' - make_interval(days => p_window_days), ev.review_date - interval '1 year') c
  CROSS JOIN LATERAL review_impact_window_stats(ARRAY[ev.listing_id], ev.review_date - interval '1 year', ev.review_date - interval '1 year' + make_interval(days => p_window_days)) d
  CROSS JOIN LATERAL review_impact_window_stats(ev.peers, ev.review_date - make_interval(days => p_window_days), ev.review_date) e
  CROSS JOIN LATERAL review_impact_window_stats(ev.peers, ev.review_date, ev.review_date + make_interval(days => p_window_days)) f
  ORDER BY ev.review_date DESC
$$;
REVOKE EXECUTE ON FUNCTION public.get_review_impact_events_v2(date, date, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_review_impact_events_v2(date, date, numeric, integer, text) TO authenticated;