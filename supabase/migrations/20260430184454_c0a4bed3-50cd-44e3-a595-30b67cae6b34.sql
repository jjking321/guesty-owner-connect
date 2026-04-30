CREATE TABLE public.listing_activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text NOT NULL,
  organization_id uuid NOT NULL,
  event_type text NOT NULL, -- 'activated' | 'deactivated' | 'listed' | 'unlisted'
  occurred_at timestamptz NOT NULL,
  actor_name text,
  actor_id text,
  source text, -- 'guesty_property_log'
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, event_type, occurred_at)
);

CREATE INDEX idx_listing_activation_events_listing ON public.listing_activation_events (listing_id, occurred_at DESC);
CREATE INDEX idx_listing_activation_events_org ON public.listing_activation_events (organization_id, occurred_at DESC);

ALTER TABLE public.listing_activation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view activation events"
ON public.listing_activation_events
FOR SELECT
USING (is_organization_member(organization_id, auth.uid()));
