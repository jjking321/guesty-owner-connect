
CREATE TABLE public.track_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  api_base_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_listings_sync_at timestamptz,
  last_reservations_sync_at timestamptz,
  last_calendar_sync_at timestamptz,
  last_reviews_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.track_accounts TO authenticated;
GRANT ALL ON public.track_accounts TO service_role;
ALTER TABLE public.track_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track accounts" ON public.track_accounts
  FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, auth.uid()));
CREATE POLICY "Org admins can insert track accounts" ON public.track_accounts
  FOR INSERT TO authenticated WITH CHECK (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role));
CREATE POLICY "Org admins can update track accounts" ON public.track_accounts
  FOR UPDATE TO authenticated USING (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role));
CREATE POLICY "Org admins can delete track accounts" ON public.track_accounts
  FOR DELETE TO authenticated USING (
    public.has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
    OR public.has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role));
CREATE TRIGGER trg_track_accounts_updated_at BEFORE UPDATE ON public.track_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.track_account_credentials (
  track_account_id uuid PRIMARY KEY REFERENCES public.track_accounts(id) ON DELETE CASCADE,
  username text NOT NULL,
  password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.track_account_credentials TO service_role;
ALTER TABLE public.track_account_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.track_listings (
  id text PRIMARY KEY,
  track_account_id uuid NOT NULL REFERENCES public.track_accounts(id) ON DELETE CASCADE,
  nickname text,
  address text,
  city text,
  state text,
  country text,
  property_type text,
  bedrooms integer,
  bathrooms numeric,
  accommodates integer,
  is_active boolean NOT NULL DEFAULT true,
  thumbnail text,
  raw_payload jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.track_listings TO authenticated;
GRANT ALL ON public.track_listings TO service_role;
ALTER TABLE public.track_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track listings" ON public.track_listings
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.track_accounts ta
    WHERE ta.id = track_listings.track_account_id
      AND public.is_organization_member(ta.organization_id, auth.uid())));
CREATE INDEX idx_track_listings_account ON public.track_listings(track_account_id);
CREATE TRIGGER trg_track_listings_updated_at BEFORE UPDATE ON public.track_listings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.track_reservations (
  id text PRIMARY KEY,
  track_account_id uuid NOT NULL REFERENCES public.track_accounts(id) ON DELETE CASCADE,
  track_listing_id text REFERENCES public.track_listings(id) ON DELETE SET NULL,
  guest_name text,
  guest_email text,
  check_in date,
  check_out date,
  nights_count integer,
  guests_count integer,
  status text,
  source text,
  channel text,
  confirmation_code text,
  sub_total numeric,
  tax_amount numeric,
  fees_amount numeric,
  total_amount numeric,
  fare_accommodation_adjusted numeric,
  currency text,
  booked_at timestamptz,
  last_updated_at_track timestamptz,
  raw_payload jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.track_reservations TO authenticated;
GRANT ALL ON public.track_reservations TO service_role;
ALTER TABLE public.track_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track reservations" ON public.track_reservations
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.track_accounts ta
    WHERE ta.id = track_reservations.track_account_id
      AND public.is_organization_member(ta.organization_id, auth.uid())));
CREATE INDEX idx_track_reservations_account_updated ON public.track_reservations(track_account_id, last_updated_at_track DESC);
CREATE INDEX idx_track_reservations_listing ON public.track_reservations(track_listing_id);
CREATE INDEX idx_track_reservations_dates ON public.track_reservations(check_in, check_out);
CREATE TRIGGER trg_track_reservations_updated_at BEFORE UPDATE ON public.track_reservations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.track_reservation_nights (
  reservation_id text NOT NULL REFERENCES public.track_reservations(id) ON DELETE CASCADE,
  listing_id text,
  night_date date NOT NULL,
  revenue_allocation numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, night_date)
);
GRANT SELECT ON public.track_reservation_nights TO authenticated;
GRANT ALL ON public.track_reservation_nights TO service_role;
ALTER TABLE public.track_reservation_nights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track nights" ON public.track_reservation_nights
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.track_reservations tr
    JOIN public.track_accounts ta ON ta.id = tr.track_account_id
    WHERE tr.id = track_reservation_nights.reservation_id
      AND public.is_organization_member(ta.organization_id, auth.uid())));
CREATE INDEX idx_track_nights_listing_date ON public.track_reservation_nights(listing_id, night_date);

CREATE TABLE public.track_capacity_calendar (
  track_listing_id text NOT NULL REFERENCES public.track_listings(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  price numeric,
  currency text,
  min_nights integer,
  block_reason text,
  status text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_listing_id, date)
);
GRANT SELECT ON public.track_capacity_calendar TO authenticated;
GRANT ALL ON public.track_capacity_calendar TO service_role;
ALTER TABLE public.track_capacity_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track calendar" ON public.track_capacity_calendar
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.track_listings tl
    JOIN public.track_accounts ta ON ta.id = tl.track_account_id
    WHERE tl.id = track_capacity_calendar.track_listing_id
      AND public.is_organization_member(ta.organization_id, auth.uid())));
CREATE INDEX idx_track_calendar_listing_date ON public.track_capacity_calendar(track_listing_id, date);

CREATE TABLE public.track_reviews (
  id text PRIMARY KEY,
  track_account_id uuid NOT NULL REFERENCES public.track_accounts(id) ON DELETE CASCADE,
  track_listing_id text REFERENCES public.track_listings(id) ON DELETE SET NULL,
  reservation_id text,
  guest_name text,
  rating numeric,
  category_ratings jsonb,
  review_text text,
  response_text text,
  source text,
  review_date date,
  is_removed boolean NOT NULL DEFAULT false,
  raw_payload jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.track_reviews TO authenticated;
GRANT ALL ON public.track_reviews TO service_role;
ALTER TABLE public.track_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view track reviews" ON public.track_reviews
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.track_accounts ta
    WHERE ta.id = track_reviews.track_account_id
      AND public.is_organization_member(ta.organization_id, auth.uid())));
CREATE INDEX idx_track_reviews_listing ON public.track_reviews(track_listing_id);
CREATE INDEX idx_track_reviews_date ON public.track_reviews(review_date DESC);
CREATE TRIGGER trg_track_reviews_updated_at BEFORE UPDATE ON public.track_reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE VIEW public.v_unified_listings WITH (security_invoker = true) AS
SELECT
  'guesty'::text AS provider,
  ('guesty:' || l.id) AS listing_uid,
  l.id::text AS provider_listing_id,
  ga.organization_id,
  l.nickname AS name,
  l.address::text AS address,
  l.bedrooms,
  NULL::numeric AS bathrooms,
  l.accommodates,
  l.property_type,
  l.thumbnail,
  l.is_listed AS is_active
FROM public.listings l
JOIN public.guesty_accounts ga ON ga.id = l.guesty_account_id
UNION ALL
SELECT
  'track'::text,
  ('track:' || tl.id),
  tl.id,
  ta.organization_id,
  tl.nickname,
  tl.address,
  tl.bedrooms,
  tl.bathrooms,
  tl.accommodates,
  tl.property_type,
  tl.thumbnail,
  tl.is_active
FROM public.track_listings tl
JOIN public.track_accounts ta ON ta.id = tl.track_account_id;
GRANT SELECT ON public.v_unified_listings TO authenticated;

CREATE OR REPLACE VIEW public.v_unified_reservations WITH (security_invoker = true) AS
SELECT
  'guesty'::text AS provider,
  ('guesty:' || r.id) AS reservation_uid,
  r.id::text AS provider_reservation_id,
  r.listing_id::text AS provider_listing_id,
  ga.organization_id,
  r.guest_name,
  r.check_in,
  r.check_out,
  r.nights_count,
  r.guests_count,
  r.status,
  r.source,
  r.confirmation_code,
  r.sub_total AS subtotal,
  r.tax_amount,
  r.fare_accommodation_adjusted,
  r.total_paid AS total_amount
FROM public.reservations r
JOIN public.guesty_accounts ga ON ga.id = r.guesty_account_id
UNION ALL
SELECT
  'track'::text,
  ('track:' || tr.id),
  tr.id,
  tr.track_listing_id,
  ta.organization_id,
  tr.guest_name,
  tr.check_in,
  tr.check_out,
  tr.nights_count,
  tr.guests_count,
  tr.status,
  tr.source,
  tr.confirmation_code,
  tr.sub_total,
  tr.tax_amount,
  tr.fare_accommodation_adjusted,
  tr.total_amount
FROM public.track_reservations tr
JOIN public.track_accounts ta ON ta.id = tr.track_account_id;
GRANT SELECT ON public.v_unified_reservations TO authenticated;

CREATE OR REPLACE VIEW public.v_unified_reservation_nights WITH (security_invoker = true) AS
SELECT
  'guesty'::text AS provider,
  ('guesty:' || rn.reservation_id) AS reservation_uid,
  rn.listing_id::text AS provider_listing_id,
  rn.night_date,
  rn.revenue_allocation
FROM public.reservation_nights rn
UNION ALL
SELECT 'track'::text, ('track:' || trn.reservation_id), trn.listing_id, trn.night_date, trn.revenue_allocation
FROM public.track_reservation_nights trn;
GRANT SELECT ON public.v_unified_reservation_nights TO authenticated;

CREATE OR REPLACE VIEW public.v_unified_calendar WITH (security_invoker = true) AS
SELECT 'guesty'::text AS provider, cc.listing_id::text AS provider_listing_id, cc.date, cc.is_available, cc.price, cc.currency, cc.min_nights, cc.block_reason, cc.status
FROM public.capacity_calendar cc
UNION ALL
SELECT 'track'::text, tcc.track_listing_id, tcc.date, tcc.is_available, tcc.price, tcc.currency, tcc.min_nights, tcc.block_reason, tcc.status
FROM public.track_capacity_calendar tcc;
GRANT SELECT ON public.v_unified_calendar TO authenticated;

CREATE OR REPLACE VIEW public.v_unified_reviews WITH (security_invoker = true) AS
SELECT
  'guesty'::text AS provider,
  ('guesty:' || rv.id) AS review_uid,
  rv.listing_id::text AS provider_listing_id,
  ('guesty:' || COALESCE(rv.reservation_id::text, '')) AS reservation_uid,
  rv.guest_name, rv.rating, rv.category_ratings, rv.review_text, rv.response_text, rv.source, rv.review_date, rv.is_removed
FROM public.reviews rv
UNION ALL
SELECT 'track'::text, ('track:' || tr.id), tr.track_listing_id, ('track:' || COALESCE(tr.reservation_id, '')),
  tr.guest_name, tr.rating, tr.category_ratings, tr.review_text, tr.response_text, tr.source, tr.review_date, tr.is_removed
FROM public.track_reviews tr;
GRANT SELECT ON public.v_unified_reviews TO authenticated;
