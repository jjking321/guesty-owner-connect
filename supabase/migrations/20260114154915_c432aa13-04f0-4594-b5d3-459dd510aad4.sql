-- Add indexes for faster comparable queries
CREATE INDEX IF NOT EXISTS idx_comparables_listing_selected 
ON property_comparables(listing_id, is_selected);

CREATE INDEX IF NOT EXISTS idx_comparables_airroi_id 
ON property_comparables(airroi_listing_id);