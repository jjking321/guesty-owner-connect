-- Update get_ytd_revenue_by_listing to use SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_ytd_revenue_by_listing(target_year integer, end_date date)
RETURNS TABLE(listing_id text, total_revenue numeric)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT 
    r.listing_id,
    COALESCE(SUM(r.fare_accommodation_adjusted), 0) as total_revenue
  FROM reservations r
  WHERE r.check_out >= make_date(target_year, 1, 1)
    AND r.check_out <= end_date
    AND r.status IN ('confirmed', 'checked_out')
    AND r.guesty_account_id IN (
      SELECT ga.id 
      FROM guesty_accounts ga 
      WHERE is_organization_member(ga.organization_id, auth.uid())
    )
  GROUP BY r.listing_id
$function$;