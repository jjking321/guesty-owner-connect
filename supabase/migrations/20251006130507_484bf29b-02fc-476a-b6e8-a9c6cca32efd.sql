-- Create role enum for organization members (only if not exists)
DO $$ BEGIN
  CREATE TYPE public.member_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create organizations table (only if not exists)
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create organization members table (only if not exists)
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- Enable RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Create trigger for updated_at on organizations
DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Security definer function to check organization membership
CREATE OR REPLACE FUNCTION public.is_organization_member(_organization_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = _organization_id
      AND user_id = _user_id
  )
$$;

-- Security definer function to check if user has a specific role in organization
CREATE OR REPLACE FUNCTION public.has_organization_role(_organization_id UUID, _user_id UUID, _role member_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = _organization_id
      AND user_id = _user_id
      AND role = _role
  )
$$;

-- Migrate existing users to organizations (skip if already done)
INSERT INTO public.organizations (name)
SELECT DISTINCT 
  COALESCE(p.company_name, p.full_name, p.email, 'My Organization') as name
FROM public.guesty_accounts ga
JOIN public.profiles p ON p.id = ga.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1);

-- Add organization_id to guesty_accounts (skip if already exists)
DO $$ BEGIN
  ALTER TABLE public.guesty_accounts ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Link existing guesty accounts to their organizations (only if not already linked)
WITH user_orgs AS (
  SELECT DISTINCT ga.user_id, o.id as org_id
  FROM public.guesty_accounts ga
  CROSS JOIN LATERAL (
    SELECT o.id FROM public.organizations o
    JOIN public.profiles p ON COALESCE(p.company_name, p.full_name, p.email, 'My Organization') = o.name
    WHERE p.id = ga.user_id
    LIMIT 1
  ) o
  WHERE ga.organization_id IS NULL
)
UPDATE public.guesty_accounts ga
SET organization_id = uo.org_id
FROM user_orgs uo
WHERE ga.user_id = uo.user_id AND ga.organization_id IS NULL;

-- Make organization_id NOT NULL after migration (skip if already not null)
DO $$ BEGIN
  ALTER TABLE public.guesty_accounts ALTER COLUMN organization_id SET NOT NULL;
EXCEPTION
  WHEN others THEN null;
END $$;

-- Add existing users as owners of their organizations (skip duplicates)
INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT DISTINCT ga.organization_id, ga.user_id, 'owner'::member_role
FROM public.guesty_accounts ga
WHERE ga.organization_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- RLS policies for organizations
DROP POLICY IF EXISTS "Users can view organizations they are members of" ON public.organizations;
CREATE POLICY "Users can view organizations they are members of"
ON public.organizations
FOR SELECT
USING (public.is_organization_member(id, auth.uid()));

DROP POLICY IF EXISTS "Organization owners can update their organization" ON public.organizations;
CREATE POLICY "Organization owners can update their organization"
ON public.organizations
FOR UPDATE
USING (public.has_organization_role(id, auth.uid(), 'owner'));

DROP POLICY IF EXISTS "Users can insert organizations and become owner" ON public.organizations;
CREATE POLICY "Users can insert organizations and become owner"
ON public.organizations
FOR INSERT
WITH CHECK (true);

-- RLS policies for organization_members
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.organization_members;
CREATE POLICY "Users can view members of their organizations"
ON public.organization_members
FOR SELECT
USING (public.is_organization_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Organization owners and admins can insert members" ON public.organization_members;
CREATE POLICY "Organization owners and admins can insert members"
ON public.organization_members
FOR INSERT
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners and admins can update members" ON public.organization_members;
CREATE POLICY "Organization owners and admins can update members"
ON public.organization_members
FOR UPDATE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners and admins can delete members" ON public.organization_members;
CREATE POLICY "Organization owners and admins can delete members"
ON public.organization_members
FOR DELETE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

-- Update guesty_accounts RLS policies
DROP POLICY IF EXISTS "Users can view own guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Users can insert own guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Users can update own guesty accounts" ON public.guesty_accounts;
DROP POLICY IF EXISTS "Users can delete own guesty accounts" ON public.guesty_accounts;

DROP POLICY IF EXISTS "Users can view guesty accounts in their organizations" ON public.guesty_accounts;
CREATE POLICY "Users can view guesty accounts in their organizations"
ON public.guesty_accounts
FOR SELECT
USING (public.is_organization_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Organization owners and admins can insert guesty accounts" ON public.guesty_accounts;
CREATE POLICY "Organization owners and admins can insert guesty accounts"
ON public.guesty_accounts
FOR INSERT
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners and admins can update guesty accounts" ON public.guesty_accounts;
CREATE POLICY "Organization owners and admins can update guesty accounts"
ON public.guesty_accounts
FOR UPDATE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners can delete guesty accounts" ON public.guesty_accounts;
CREATE POLICY "Organization owners can delete guesty accounts"
ON public.guesty_accounts
FOR DELETE
USING (public.has_organization_role(organization_id, auth.uid(), 'owner'));

-- Update listings RLS policies
DROP POLICY IF EXISTS "Users can view own listings" ON public.listings;
DROP POLICY IF EXISTS "Users can insert own listings" ON public.listings;
DROP POLICY IF EXISTS "Users can update own listings" ON public.listings;

DROP POLICY IF EXISTS "Users can view listings in their organizations" ON public.listings;
CREATE POLICY "Users can view listings in their organizations"
ON public.listings
FOR SELECT
USING (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can insert listings in their organizations" ON public.listings;
CREATE POLICY "Users can insert listings in their organizations"
ON public.listings
FOR INSERT
WITH CHECK (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can update listings in their organizations" ON public.listings;
CREATE POLICY "Users can update listings in their organizations"
ON public.listings
FOR UPDATE
USING (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

-- Update reservations RLS policies
DROP POLICY IF EXISTS "Users can view own reservations" ON public.reservations;
DROP POLICY IF EXISTS "Users can insert own reservations" ON public.reservations;
DROP POLICY IF EXISTS "Users can update own reservations" ON public.reservations;

DROP POLICY IF EXISTS "Users can view reservations in their organizations" ON public.reservations;
CREATE POLICY "Users can view reservations in their organizations"
ON public.reservations
FOR SELECT
USING (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can insert reservations in their organizations" ON public.reservations;
CREATE POLICY "Users can insert reservations in their organizations"
ON public.reservations
FOR INSERT
WITH CHECK (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can update reservations in their organizations" ON public.reservations;
CREATE POLICY "Users can update reservations in their organizations"
ON public.reservations
FOR UPDATE
USING (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

-- Update property_goals RLS policies
DROP POLICY IF EXISTS "Users can view goals for their listings" ON public.property_goals;
DROP POLICY IF EXISTS "Users can insert goals for their listings" ON public.property_goals;
DROP POLICY IF EXISTS "Users can update goals for their listings" ON public.property_goals;
DROP POLICY IF EXISTS "Users can delete goals for their listings" ON public.property_goals;

DROP POLICY IF EXISTS "Users can view goals in their organizations" ON public.property_goals;
CREATE POLICY "Users can view goals in their organizations"
ON public.property_goals
FOR SELECT
USING (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can insert goals in their organizations" ON public.property_goals;
CREATE POLICY "Users can insert goals in their organizations"
ON public.property_goals
FOR INSERT
WITH CHECK (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can update goals in their organizations" ON public.property_goals;
CREATE POLICY "Users can update goals in their organizations"
ON public.property_goals
FOR UPDATE
USING (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can delete goals in their organizations" ON public.property_goals;
CREATE POLICY "Users can delete goals in their organizations"
ON public.property_goals
FOR DELETE
USING (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

-- Update revenue_forecasts RLS policies
DROP POLICY IF EXISTS "Users can view forecasts for their listings" ON public.revenue_forecasts;
DROP POLICY IF EXISTS "Users can insert forecasts for their listings" ON public.revenue_forecasts;
DROP POLICY IF EXISTS "Users can update forecasts for their listings" ON public.revenue_forecasts;

DROP POLICY IF EXISTS "Users can view forecasts in their organizations" ON public.revenue_forecasts;
CREATE POLICY "Users can view forecasts in their organizations"
ON public.revenue_forecasts
FOR SELECT
USING (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can insert forecasts in their organizations" ON public.revenue_forecasts;
CREATE POLICY "Users can insert forecasts in their organizations"
ON public.revenue_forecasts
FOR INSERT
WITH CHECK (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

DROP POLICY IF EXISTS "Users can update forecasts in their organizations" ON public.revenue_forecasts;
CREATE POLICY "Users can update forecasts in their organizations"
ON public.revenue_forecasts
FOR UPDATE
USING (listing_id IN (
  SELECT l.id FROM public.listings l
  JOIN public.guesty_accounts ga ON l.guesty_account_id = ga.id
  WHERE public.is_organization_member(ga.organization_id, auth.uid())
));

-- Update sync_jobs RLS policies
DROP POLICY IF EXISTS "Users can view own sync jobs" ON public.sync_jobs;

DROP POLICY IF EXISTS "Users can view sync jobs in their organizations" ON public.sync_jobs;
CREATE POLICY "Users can view sync jobs in their organizations"
ON public.sync_jobs
FOR SELECT
USING (guesty_account_id IN (
  SELECT id FROM public.guesty_accounts
  WHERE public.is_organization_member(organization_id, auth.uid())
));

-- Update property_groups RLS policies
DROP POLICY IF EXISTS "Users can view own groups" ON public.property_groups;
DROP POLICY IF EXISTS "Users can insert own groups" ON public.property_groups;
DROP POLICY IF EXISTS "Users can update own groups" ON public.property_groups;
DROP POLICY IF EXISTS "Users can delete own groups" ON public.property_groups;

-- Add organization_id to property_groups (skip if already exists)
DO $$ BEGIN
  ALTER TABLE public.property_groups ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Migrate existing property groups to organizations (only if not already linked)
UPDATE public.property_groups pg
SET organization_id = (
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = pg.user_id
  LIMIT 1
)
WHERE pg.organization_id IS NULL;

-- Make organization_id NOT NULL after migration (skip if already not null)
DO $$ BEGIN
  ALTER TABLE public.property_groups ALTER COLUMN organization_id SET NOT NULL;
EXCEPTION
  WHEN others THEN null;
END $$;

DROP POLICY IF EXISTS "Users can view groups in their organizations" ON public.property_groups;
CREATE POLICY "Users can view groups in their organizations"
ON public.property_groups
FOR SELECT
USING (public.is_organization_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Users can insert groups in their organizations" ON public.property_groups;
CREATE POLICY "Users can insert groups in their organizations"
ON public.property_groups
FOR INSERT
WITH CHECK (public.is_organization_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Organization owners and admins can update groups" ON public.property_groups;
CREATE POLICY "Organization owners and admins can update groups"
ON public.property_groups
FOR UPDATE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners and admins can delete groups" ON public.property_groups;
CREATE POLICY "Organization owners and admins can delete groups"
ON public.property_groups
FOR DELETE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);