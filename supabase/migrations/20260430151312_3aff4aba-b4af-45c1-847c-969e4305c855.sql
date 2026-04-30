-- 1. listing_status_snapshots
CREATE TABLE public.listing_status_snapshots (
  organization_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  total_listed integer NOT NULL DEFAULT 0,
  total_active integer NOT NULL DEFAULT 0,
  total_archived integer NOT NULL DEFAULT 0,
  total_churned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, snapshot_date)
);

ALTER TABLE public.listing_status_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view listing status snapshots"
  ON public.listing_status_snapshots
  FOR SELECT
  USING (is_organization_member(organization_id, auth.uid()));

CREATE INDEX idx_listing_status_snapshots_org_date
  ON public.listing_status_snapshots(organization_id, snapshot_date);

-- 2. listing_churn_events
CREATE TABLE public.listing_churn_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  listing_id text NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  churned_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz NULL,
  reason text NULL,
  category text NULL,
  notes text NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_churn_events ENABLE ROW LEVEL SECURITY;

-- Only one open churn event per listing
CREATE UNIQUE INDEX idx_listing_churn_events_one_open
  ON public.listing_churn_events(listing_id)
  WHERE restored_at IS NULL;

CREATE INDEX idx_listing_churn_events_org_churned_at
  ON public.listing_churn_events(organization_id, churned_at);

CREATE POLICY "Org members can view churn events"
  ON public.listing_churn_events
  FOR SELECT
  USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Admins can insert churn events"
  ON public.listing_churn_events
  FOR INSERT
  WITH CHECK (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

CREATE POLICY "Admins can update churn events"
  ON public.listing_churn_events
  FOR UPDATE
  USING (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

CREATE POLICY "Admins can delete churn events"
  ON public.listing_churn_events
  FOR DELETE
  USING (
    has_organization_role(organization_id, auth.uid(), 'super_admin'::member_role)
    OR has_organization_role(organization_id, auth.uid(), 'admin'::member_role)
  );

CREATE TRIGGER trg_listing_churn_events_updated_at
  BEFORE UPDATE ON public.listing_churn_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. listings.last_active_at
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NULL;