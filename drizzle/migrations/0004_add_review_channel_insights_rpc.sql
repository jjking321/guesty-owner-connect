CREATE OR REPLACE FUNCTION public.get_review_channel_insights(
  p_listing_id TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE(
  source TEXT,
  total_reviews BIGINT,
  avg_rating NUMERIC,
  five_star_count BIGINT,
  sub_five_count BIGINT,
  with_text_count BIGINT,
  with_categories_count BIGINT,
  category_stats JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH filtered AS (
    SELECT r.id, r.rating, COALESCE(r.source, 'Unknown') AS src, r.review_text, r.category_ratings
    FROM reviews r
    JOIN listings l ON l.id = r.listing_id
    JOIN guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE r.is_removed = false
      AND public.is_organization_member(ga.organization_id, auth.uid())
      AND (p_listing_id IS NULL OR r.listing_id = p_listing_id)
      AND (p_start_date IS NULL OR r.review_date >= p_start_date)
      AND (p_end_date IS NULL OR r.review_date <= p_end_date)
  ),
  cats AS (
    SELECT f.src,
           kv.key AS cat_key,
           AVG((kv.value)::numeric) AS avg_all,
           AVG((kv.value)::numeric) FILTER (WHERE f.rating < 5) AS avg_sub5,
           COUNT(*) FILTER (WHERE (kv.value)::numeric < 5) AS sub5_hits,
           COUNT(*) AS samples
    FROM filtered f
    CROSS JOIN LATERAL jsonb_each_text(f.category_ratings) AS kv(key, value)
    WHERE f.category_ratings IS NOT NULL
    GROUP BY f.src, kv.key
  ),
  cats_agg AS (
    SELECT c.src,
           jsonb_agg(jsonb_build_object(
             'category', c.cat_key,
             'avg_all', ROUND(c.avg_all, 2),
             'avg_sub5', ROUND(c.avg_sub5, 2),
             'sub5_hits', c.sub5_hits,
             'samples', c.samples
           ) ORDER BY c.sub5_hits DESC) AS stats
    FROM cats c
    GROUP BY c.src
  )
  SELECT
    f.src,
    COUNT(*)::bigint,
    ROUND(AVG(f.rating), 2),
    COUNT(*) FILTER (WHERE f.rating >= 5)::bigint,
    COUNT(*) FILTER (WHERE f.rating IS NOT NULL AND f.rating < 5)::bigint,
    COUNT(*) FILTER (WHERE f.review_text IS NOT NULL AND length(f.review_text) > 5)::bigint,
    COUNT(*) FILTER (WHERE f.category_ratings IS NOT NULL)::bigint,
    COALESCE(ca.stats, '[]'::jsonb)
  FROM filtered f
  LEFT JOIN cats_agg ca ON ca.src = f.src
  GROUP BY f.src, ca.stats
  ORDER BY COUNT(*) DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_review_channel_insights(text, date, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_channel_insights(text, date, date) TO authenticated;