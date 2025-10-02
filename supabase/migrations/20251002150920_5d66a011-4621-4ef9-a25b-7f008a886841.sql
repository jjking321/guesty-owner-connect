-- Add goal_targets column to revenue_forecasts table
ALTER TABLE revenue_forecasts 
ADD COLUMN IF NOT EXISTS goal_targets jsonb DEFAULT '{}'::jsonb;