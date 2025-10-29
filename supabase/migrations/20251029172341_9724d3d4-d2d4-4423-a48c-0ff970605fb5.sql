-- Add 'owner' to member_role enum
ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'owner';

-- Create table to link user accounts to owner records
CREATE TABLE IF NOT EXISTS public.owner_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(owner_id),
  UNIQUE(user_id)
);

-- Create table to manually assign owners to groups
CREATE TABLE IF NOT EXISTS public.owner_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.property_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(owner_id, group_id)
);

-- Enable RLS on new tables
ALTER TABLE public.owner_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_groups ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if user is an owner and get their owner_id
CREATE OR REPLACE FUNCTION public.get_user_owner_id(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT owner_id
  FROM public.owner_users
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Security definer function to check if a listing belongs to an owner
CREATE OR REPLACE FUNCTION public.is_owner_listing(_owner_id TEXT, _listing_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listings
    WHERE id = _listing_id
      AND owner_id = _owner_id
  )
$$;

-- Security definer function to check if a listing is in owner's groups
CREATE OR REPLACE FUNCTION public.is_listing_in_owner_groups(_owner_id TEXT, _listing_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.owner_groups og
    JOIN public.property_group_members pgm ON og.group_id = pgm.group_id
    WHERE og.owner_id = _owner_id
      AND pgm.listing_id = _listing_id
  )
$$;

-- RLS policies for owner_users
CREATE POLICY "Admins can manage owner_users"
ON public.owner_users
FOR ALL
USING (
  has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role) OR
  has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
);

CREATE POLICY "Owners can view their own owner_user record"
ON public.owner_users
FOR SELECT
USING (user_id = auth.uid());

-- RLS policies for owner_groups
CREATE POLICY "Admins can manage owner_groups"
ON public.owner_groups
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.property_groups pg
    WHERE pg.id = group_id
      AND (
        has_organization_role(pg.organization_id, auth.uid(), 'super_admin'::member_role) OR
        has_organization_role(pg.organization_id, auth.uid(), 'admin'::member_role)
      )
  )
);

CREATE POLICY "Owners can view their assigned groups"
ON public.owner_groups
FOR SELECT
USING (owner_id = get_user_owner_id(auth.uid()));

-- Update listings RLS to allow owners to see their listings and group listings
CREATE POLICY "Owners can view their listings"
ON public.listings
FOR SELECT
USING (
  owner_id = get_user_owner_id(auth.uid()) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), id)
);

-- Update reservations RLS to allow owners to see their reservations
CREATE POLICY "Owners can view their reservations"
ON public.reservations
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Update reservation_nights RLS to allow owners to see their reservation nights
CREATE POLICY "Owners can view their reservation nights"
ON public.reservation_nights
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Update property_goals RLS to allow owners to see their goals
CREATE POLICY "Owners can view their property goals"
ON public.property_goals
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Update revenue_forecasts RLS to allow owners to see their forecasts
CREATE POLICY "Owners can view their forecasts"
ON public.revenue_forecasts
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Update reviews RLS to allow owners to see their reviews
CREATE POLICY "Owners can view their reviews"
ON public.reviews
FOR SELECT
USING (
  is_owner_listing(get_user_owner_id(auth.uid()), listing_id) OR
  is_listing_in_owner_groups(get_user_owner_id(auth.uid()), listing_id)
);

-- Update property_groups RLS to allow owners to view their assigned groups
CREATE POLICY "Owners can view their assigned groups"
ON public.property_groups
FOR SELECT
USING (
  id IN (
    SELECT group_id
    FROM public.owner_groups
    WHERE owner_id = get_user_owner_id(auth.uid())
  )
);

-- Update property_group_members RLS to allow owners to view members of their groups
CREATE POLICY "Owners can view their group members"
ON public.property_group_members
FOR SELECT
USING (
  group_id IN (
    SELECT group_id
    FROM public.owner_groups
    WHERE owner_id = get_user_owner_id(auth.uid())
  )
);

-- Update owners RLS to allow owners to view their own record
CREATE POLICY "Owners can view their own record"
ON public.owners
FOR SELECT
USING (id = get_user_owner_id(auth.uid()));