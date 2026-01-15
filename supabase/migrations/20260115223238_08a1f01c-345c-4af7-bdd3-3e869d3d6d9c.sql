-- Create RPC function to aggregate reservation nights data server-side
-- This avoids the 1,000 row limit issue by returning one row per listing
CREATE OR REPLACE FUNCTION public.get_portfolio_night_metrics(
  p_year integer,
  p_month integer DEFAULT NULL  -- NULL = full year, 1-12 = specific month
)
RETURNS TABLE (
  listing_id text,
  actual_revenue numeric,
  otb_revenue numeric,
  past_nights integer,
  future_nights integer
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    rn.listing_id::text,
    COALESCE(SUM(CASE WHEN rn.night_date < CURRENT_DATE THEN rn.revenue_allocation ELSE 0 END), 0) as actual_revenue,
    COALESCE(SUM(CASE WHEN rn.night_date >= CURRENT_DATE THEN rn.revenue_allocation ELSE 0 END), 0) as otb_revenue,
    COALESCE(COUNT(CASE WHEN rn.night_date < CURRENT_DATE THEN 1 END), 0)::integer as past_nights,
    COALESCE(COUNT(CASE WHEN rn.night_date >= CURRENT_DATE THEN 1 END), 0)::integer as future_nights
  FROM reservation_nights rn
  WHERE 
    EXTRACT(YEAR FROM rn.night_date) = p_year
    AND (p_month IS NULL OR EXTRACT(MONTH FROM rn.night_date) = p_month)
  GROUP BY rn.listing_id
$$;