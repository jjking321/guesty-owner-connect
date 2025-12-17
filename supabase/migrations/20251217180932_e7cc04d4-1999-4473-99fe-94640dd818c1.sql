-- Add TTM rollup columns to property_comparables
ALTER TABLE property_comparables
ADD COLUMN IF NOT EXISTS ttm_revenue NUMERIC,
ADD COLUMN IF NOT EXISTS ttm_adr NUMERIC,
ADD COLUMN IF NOT EXISTS ttm_occupancy NUMERIC,
ADD COLUMN IF NOT EXISTS ttm_revpar NUMERIC,
ADD COLUMN IF NOT EXISTS prior_ttm_revenue NUMERIC,
ADD COLUMN IF NOT EXISTS prior_ttm_adr NUMERIC,
ADD COLUMN IF NOT EXISTS prior_ttm_occupancy NUMERIC,
ADD COLUMN IF NOT EXISTS prior_ttm_revpar NUMERIC,
ADD COLUMN IF NOT EXISTS rollups_calculated_at TIMESTAMPTZ;

-- Create property_compset_summary table
CREATE TABLE IF NOT EXISTS public.property_compset_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL UNIQUE,
  avg_ttm_revenue NUMERIC,
  avg_ttm_adr NUMERIC,
  avg_ttm_occupancy NUMERIC,
  avg_ttm_revpar NUMERIC,
  avg_prior_ttm_revenue NUMERIC,
  avg_prior_ttm_adr NUMERIC,
  avg_prior_ttm_occupancy NUMERIC,
  avg_prior_ttm_revpar NUMERIC,
  selected_comparables_count INTEGER DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key constraint
ALTER TABLE public.property_compset_summary
ADD CONSTRAINT property_compset_summary_listing_id_fkey
FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

-- Enable RLS on property_compset_summary
ALTER TABLE public.property_compset_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies for property_compset_summary (matching property_comparables pattern)
CREATE POLICY "Users can view compset summary in their organizations"
ON public.property_compset_summary
FOR SELECT
USING (
  listing_id IN (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Users can insert compset summary in their organizations"
ON public.property_compset_summary
FOR INSERT
WITH CHECK (
  listing_id IN (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Users can update compset summary in their organizations"
ON public.property_compset_summary
FOR UPDATE
USING (
  listing_id IN (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Users can delete compset summary in their organizations"
ON public.property_compset_summary
FOR DELETE
USING (
  listing_id IN (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

CREATE POLICY "Owners can view their compset summary"
ON public.property_compset_summary
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id)
  OR is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);