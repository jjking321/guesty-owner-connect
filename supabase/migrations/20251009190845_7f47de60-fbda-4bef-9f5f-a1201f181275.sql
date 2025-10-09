-- Create owners table
CREATE TABLE public.owners (
  id text PRIMARY KEY,
  guesty_account_id uuid NOT NULL REFERENCES guesty_accounts(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  listing_ids jsonb DEFAULT '[]'::jsonb,
  imported_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Index for performance
CREATE INDEX idx_owners_guesty_account ON owners(guesty_account_id);
CREATE INDEX idx_owners_email ON owners(email);

-- Enable RLS
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view owners in their organizations"
  ON public.owners FOR SELECT
  USING (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

CREATE POLICY "Users can insert owners in their organizations"
  ON public.owners FOR INSERT
  WITH CHECK (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

CREATE POLICY "Users can update owners in their organizations"
  ON public.owners FOR UPDATE
  USING (
    guesty_account_id IN (
      SELECT id FROM guesty_accounts
      WHERE is_organization_member(organization_id, auth.uid())
    )
  );

-- Trigger for updated_at
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.owners
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Add owner_id to listings table
ALTER TABLE public.listings
ADD COLUMN owner_id text REFERENCES public.owners(id) ON DELETE SET NULL;

-- Index for joins
CREATE INDEX idx_listings_owner_id ON listings(owner_id);

-- Add last_owners_sync to guesty_accounts table
ALTER TABLE public.guesty_accounts
ADD COLUMN last_owners_sync timestamp with time zone;