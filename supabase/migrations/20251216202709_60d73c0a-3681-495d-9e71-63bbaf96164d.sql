-- Create property_comparables table to store Air ROI comparable listings
CREATE TABLE public.property_comparables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL,
  airroi_listing_id BIGINT NOT NULL,
  listing_name TEXT,
  listing_type TEXT,
  room_type TEXT,
  cover_photo_url TEXT,
  host_name TEXT,
  superhost BOOLEAN DEFAULT FALSE,
  location_info JSONB, -- country, region, locality, district, lat, lng
  property_details JSONB, -- guests, bedrooms, beds, baths, amenities
  booking_settings JSONB, -- instant_book, min_nights, cancellation_policy
  pricing_info JSONB, -- currency, cleaning_fee, extra_guest_fee
  ratings JSONB, -- num_reviews, rating_overall, etc.
  performance_metrics JSONB, -- ttm_revenue, ttm_occupancy, adr, etc.
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  is_selected BOOLEAN DEFAULT FALSE,
  selected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id, airroi_listing_id)
);

-- Add foreign key constraint
ALTER TABLE public.property_comparables
ADD CONSTRAINT property_comparables_listing_id_fkey
FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_property_comparables_listing_id ON public.property_comparables(listing_id);
CREATE INDEX idx_property_comparables_is_selected ON public.property_comparables(listing_id, is_selected);

-- Enable RLS
ALTER TABLE public.property_comparables ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view comparables for listings in their organizations
CREATE POLICY "Users can view comparables in their organizations"
ON public.property_comparables
FOR SELECT
USING (
  listing_id IN (
    SELECT l.id FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- RLS Policy: Users can insert comparables for listings in their organizations
CREATE POLICY "Users can insert comparables in their organizations"
ON public.property_comparables
FOR INSERT
WITH CHECK (
  listing_id IN (
    SELECT l.id FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- RLS Policy: Users can update comparables for listings in their organizations
CREATE POLICY "Users can update comparables in their organizations"
ON public.property_comparables
FOR UPDATE
USING (
  listing_id IN (
    SELECT l.id FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- RLS Policy: Users can delete comparables for listings in their organizations
CREATE POLICY "Users can delete comparables in their organizations"
ON public.property_comparables
FOR DELETE
USING (
  listing_id IN (
    SELECT l.id FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- RLS Policy: Owners can view comparables for their listings
CREATE POLICY "Owners can view their comparables"
ON public.property_comparables
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) 
  OR is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Create trigger for updated_at
CREATE TRIGGER update_property_comparables_updated_at
BEFORE UPDATE ON public.property_comparables
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();