-- Create a function to get monthly rating trends
CREATE OR REPLACE FUNCTION public.get_monthly_rating_trend(
  p_listing_id TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  month TEXT,
  avg_rating NUMERIC,
  review_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    to_char(date_trunc('month', r.review_date::date), 'YYYY-MM') AS month,
    ROUND(AVG(r.rating)::numeric, 2) AS avg_rating,
    COUNT(*)::bigint AS review_count
  FROM reviews r
  WHERE r.is_removed = false
    AND r.rating IS NOT NULL
    AND (p_listing_id IS NULL OR r.listing_id = p_listing_id)
    AND (p_start_date IS NULL OR r.review_date::date >= p_start_date)
    AND (p_end_date IS NULL OR r.review_date::date <= p_end_date)
  GROUP BY date_trunc('month', r.review_date::date)
  ORDER BY date_trunc('month', r.review_date::date) ASC;
END;
$$;