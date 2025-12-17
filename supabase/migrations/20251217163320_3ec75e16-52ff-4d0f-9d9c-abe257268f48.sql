-- Add columns to store historical metrics from Air ROI API
ALTER TABLE property_comparables 
ADD COLUMN IF NOT EXISTS historical_metrics jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS metrics_fetched_at timestamptz DEFAULT NULL;