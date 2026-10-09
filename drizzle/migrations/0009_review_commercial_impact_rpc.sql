CREATE OR REPLACE FUNCTION public.get_review_commercial_impact(p_start_date date, p_end_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_py_start date := (p_start_date - interval '1 year')::date;
  v_py_end date := (p_end_date - interval '1 year')::date;
  v_result jsonb;
BEGIN
  WITH my_listings AS (
    SELECT l.id, l.nickname, l.address->>'city' AS city
    FROM listings l JOIN guesty_accounts ga ON ga.id = l.guesty_account_id
    WHERE l.is_listed = true AND l.archived = false
      AND public.is_organization_member(ga.organization_id, auth.uid())
  ),
  res AS (
    SELECT r.listing_id,
      CASE
        WHEN lower(r.source) LIKE 'airbnb%' THEN 'Airbnb'
        WHEN lower(r.source) IN ('vrbo','homeaway') THEN 'VRBO'
        WHEN lower(r.source) LIKE 'booking%' THEN 'Booking.com'
        WHEN lower(r.source) IN ('manual','website','be-api','direct','hostai') THEN 'Direct'
        ELSE 'Other' END AS channel,
      (r.check_in >= p_start_date) AS is_cur,
      COALESCE(r.nights_count,0) AS nights,
      COALESCE(r.fare_accommodation_adjusted, r.sub_total, 0) AS revenue
    FROM reservations r JOIN my_listings ml ON ml.id = r.listing_id
    WHERE r.status IN ('confirmed','closed')
      AND COALESCE(r.source,'') NOT IN ('owner','owner-guest')
      AND ((r.check_in BETWEEN p_start_date AND p_end_date) OR (r.check_in BETWEEN v_py_start AND v_py_end))
  ),
  res_agg AS (
    SELECT listing_id, channel,
      COUNT(*) FILTER (WHERE is_cur) AS cur_bookings,
      COALESCE(SUM(nights) FILTER (WHERE is_cur),0) AS cur_nights,
      COALESCE(SUM(revenue) FILTER (WHERE is_cur),0) AS cur_revenue,
      COUNT(*) FILTER (WHERE NOT is_cur) AS py_bookings,
      COALESCE(SUM(nights) FILTER (WHERE NOT is_cur),0) AS py_nights,
      COALESCE(SUM(revenue) FILTER (WHERE NOT is_cur),0) AS py_revenue
    FROM res GROUP BY 1,2
  ),
  rev AS (
    SELECT rv.listing_id, rv.source AS channel, rv.rating, rv.review_text
    FROM reviews rv JOIN my_listings ml ON ml.id = rv.listing_id
    WHERE rv.is_removed = false AND rv.rating IS NOT NULL
      AND rv.review_date >= p_start_date AND rv.review_date < (p_end_date + 1)
  ),
  rev_agg AS (
    SELECT listing_id, channel, COUNT(*) AS reviews, ROUND(AVG(rating),2) AS avg_rating,
      COUNT(*) FILTER (WHERE rating >= 5) AS five_star,
      COALESCE(jsonb_agg(jsonb_build_object('r', rating, 't', left(COALESCE(review_text,''), 400)))
        FILTER (WHERE rating < 5), '[]'::jsonb) AS low
    FROM rev GROUP BY 1,2
  ),
  combined AS (
    SELECT COALESCE(a.listing_id, b.listing_id) AS listing_id, COALESCE(a.channel, b.channel) AS channel,
      a.cur_bookings, a.cur_nights, a.cur_revenue, a.py_bookings, a.py_nights, a.py_revenue,
      b.reviews, b.avg_rating, b.five_star, b.low
    FROM res_agg a FULL JOIN rev_agg b ON a.listing_id = b.listing_id AND a.channel = b.channel
  )
  SELECT jsonb_build_object(
    'listings', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', nickname, 'city', city)), '[]'::jsonb) FROM my_listings),
    'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'l', listing_id, 'c', channel,
      'cb', COALESCE(cur_bookings,0), 'cn', COALESCE(cur_nights,0), 'cr', COALESCE(cur_revenue,0),
      'pb', COALESCE(py_bookings,0), 'pn', COALESCE(py_nights,0), 'pr', COALESCE(py_revenue,0),
      'rv', COALESCE(reviews,0), 'ar', avg_rating, 'fs', COALESCE(five_star,0), 'low', COALESCE(low,'[]'::jsonb)
    )), '[]'::jsonb) FROM combined)
  ) INTO v_result;
  RETURN v_result;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_review_commercial_impact(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_review_commercial_impact(date, date) TO authenticated;