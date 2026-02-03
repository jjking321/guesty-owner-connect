-- Update get_review_summary_stats to handle null ratings explicitly
CREATE OR REPLACE FUNCTION public.get_review_summary_stats(
  p_listing_id TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE(
  total_reviews BIGINT,
  avg_rating NUMERIC,
  rating_1_count BIGINT,
  rating_2_count BIGINT,
  rating_3_count BIGINT,
  rating_4_count BIGINT,
  rating_5_count BIGINT,
  platform_stats JSONB,
  category_averages JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_reviews AS (
    SELECT r.rating, r.source, r.category_ratings
    FROM reviews r
    WHERE r.is_removed = false
      AND (p_listing_id IS NULL OR r.listing_id = p_listing_id)
      AND (p_start_date IS NULL OR r.review_date >= p_start_date)
      AND (p_end_date IS NULL OR r.review_date <= p_end_date)
  ),
  rating_counts AS (
    SELECT
      COUNT(*) AS total,
      AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS avg_rat,
      COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 1) AS r1,
      COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 2) AS r2,
      COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 3) AS r3,
      COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 4) AS r4,
      COUNT(*) FILTER (WHERE rating IS NOT NULL AND ROUND(rating) = 5) AS r5
    FROM filtered_reviews
  ),
  platform_agg AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'source', source,
        'count', cnt,
        'avg_rating', avg_rat
      )
    ) AS stats
    FROM (
      SELECT 
        COALESCE(source, 'unknown') AS source,
        COUNT(*) AS cnt,
        AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS avg_rat
      FROM filtered_reviews
      GROUP BY source
      ORDER BY COUNT(*) DESC
    ) p
  ),
  category_agg AS (
    SELECT jsonb_object_agg(cat_key, cat_avg) AS averages
    FROM (
      SELECT 
        key AS cat_key,
        AVG((value)::numeric) AS cat_avg
      FROM filtered_reviews,
        jsonb_each_text(category_ratings::jsonb)
      WHERE category_ratings IS NOT NULL
      GROUP BY key
    ) c
  )
  SELECT
    rc.total,
    ROUND(rc.avg_rat, 2),
    rc.r1,
    rc.r2,
    rc.r3,
    rc.r4,
    rc.r5,
    COALESCE(pa.stats, '[]'::jsonb),
    COALESCE(ca.averages, '{}'::jsonb)
  FROM rating_counts rc
  CROSS JOIN platform_agg pa
  CROSS JOIN category_agg ca;
END;
$$;