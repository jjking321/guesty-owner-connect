-- Create property_actionables table
CREATE TABLE property_actionables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  
  -- Aggregated property-level data
  total_issue_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  aggregate_score INTEGER NOT NULL DEFAULT 0,
  
  -- Individual issues stored as JSONB array
  issues JSONB NOT NULL DEFAULT '[]',
  
  -- AI-generated summary for the property
  ai_summary TEXT,
  
  -- Status tracking
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast queries
CREATE INDEX idx_property_actionables_org ON property_actionables(organization_id, aggregate_score DESC);
CREATE INDEX idx_property_actionables_listing ON property_actionables(listing_id);
CREATE INDEX idx_property_actionables_dismissed ON property_actionables(organization_id, dismissed, aggregate_score DESC);

-- Add unique constraint to prevent duplicates
CREATE UNIQUE INDEX idx_property_actionables_unique ON property_actionables(listing_id) WHERE dismissed = false;

-- Enable RLS
ALTER TABLE property_actionables ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view org actionables" ON property_actionables
  FOR SELECT USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Users can update org actionables" ON property_actionables
  FOR UPDATE USING (is_organization_member(organization_id, auth.uid()));

CREATE POLICY "Service role can manage actionables" ON property_actionables
  FOR ALL USING (true);

-- Add actionables_generation_enabled column to guesty_accounts
ALTER TABLE guesty_accounts ADD COLUMN actionables_generation_enabled BOOLEAN DEFAULT true;

-- Create trigger for updated_at
CREATE TRIGGER handle_property_actionables_updated_at
  BEFORE UPDATE ON property_actionables
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();