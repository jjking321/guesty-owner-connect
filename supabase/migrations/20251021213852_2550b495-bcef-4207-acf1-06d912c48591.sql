-- Create reviews table
CREATE TABLE public.reviews (
  id text PRIMARY KEY,
  guesty_account_id uuid NOT NULL REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  listing_id text NOT NULL,
  reservation_id text,
  guest_name text,
  rating numeric,
  review_text text,
  response_text text,
  review_date timestamp with time zone,
  source text,
  is_removed boolean NOT NULL DEFAULT false,
  removed_at timestamp with time zone,
  removed_by uuid REFERENCES auth.users(id),
  removed_reason text,
  category_ratings jsonb,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies for reviews
CREATE POLICY "Users can view reviews in their organizations"
  ON public.reviews
  FOR SELECT
  USING (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts 
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

CREATE POLICY "Users can update reviews in their organizations"
  ON public.reviews
  FOR UPDATE
  USING (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts 
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

CREATE POLICY "Users can insert reviews in their organizations"
  ON public.reviews
  FOR INSERT
  WITH CHECK (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts 
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

-- Add last_reviews_sync to guesty_accounts
ALTER TABLE public.guesty_accounts
ADD COLUMN last_reviews_sync timestamp with time zone;

-- Create index for better performance
CREATE INDEX idx_reviews_listing_id ON public.reviews(listing_id);
CREATE INDEX idx_reviews_source ON public.reviews(source);
CREATE INDEX idx_reviews_is_removed ON public.reviews(is_removed);

-- Add trigger for updated_at
CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();