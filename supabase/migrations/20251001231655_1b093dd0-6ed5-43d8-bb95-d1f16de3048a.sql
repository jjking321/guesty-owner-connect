-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create guesty_accounts table to store API credentials
CREATE TABLE IF NOT EXISTS public.guesty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  api_token TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, account_name)
);

-- Enable RLS on guesty_accounts
ALTER TABLE public.guesty_accounts ENABLE ROW LEVEL SECURITY;

-- Guesty accounts policies
CREATE POLICY "Users can view own guesty accounts"
  ON public.guesty_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own guesty accounts"
  ON public.guesty_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own guesty accounts"
  ON public.guesty_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own guesty accounts"
  ON public.guesty_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Create listings table
CREATE TABLE IF NOT EXISTS public.listings (
  id TEXT PRIMARY KEY,
  guesty_account_id UUID NOT NULL REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  created_at_guesty TIMESTAMPTZ,
  nickname TEXT,
  status TEXT,
  is_listed BOOLEAN,
  active BOOLEAN,
  property_type TEXT,
  accommodates INTEGER,
  bedrooms INTEGER,
  address JSONB,
  thumbnail TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on listings
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

-- Listings policies (users can view listings from their accounts)
CREATE POLICY "Users can view own listings"
  ON public.listings FOR SELECT
  USING (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own listings"
  ON public.listings FOR INSERT
  WITH CHECK (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own listings"
  ON public.listings FOR UPDATE
  USING (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

-- Create reservations table
CREATE TABLE IF NOT EXISTS public.reservations (
  id TEXT PRIMARY KEY,
  guesty_account_id UUID NOT NULL REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  status TEXT,
  check_in DATE,
  check_out DATE,
  nights_count INTEGER,
  guests_count INTEGER,
  fare_accommodation_adjusted DECIMAL(10, 2),
  host_payout DECIMAL(10, 2),
  total_paid DECIMAL(10, 2),
  owner_revenue DECIMAL(10, 2),
  source TEXT,
  confirmation_code TEXT,
  created_at_guesty TIMESTAMPTZ,
  last_updated_at_guesty TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on reservations
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Reservations policies
CREATE POLICY "Users can view own reservations"
  ON public.reservations FOR SELECT
  USING (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own reservations"
  ON public.reservations FOR INSERT
  WITH CHECK (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own reservations"
  ON public.reservations FOR UPDATE
  USING (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

-- Create function to automatically create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Add updated_at triggers
CREATE TRIGGER handle_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_guesty_accounts_updated_at
  BEFORE UPDATE ON public.guesty_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_reservations_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();