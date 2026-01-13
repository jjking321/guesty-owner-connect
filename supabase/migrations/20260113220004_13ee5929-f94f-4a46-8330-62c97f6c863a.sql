-- Add new columns to revenue_forecasts table for probability-weighted forecasting
ALTER TABLE public.revenue_forecasts 
ADD COLUMN IF NOT EXISTS probability_weighted_revenue NUMERIC,
ADD COLUMN IF NOT EXISTS avg_open_night_probability NUMERIC,
ADD COLUMN IF NOT EXISTS compset_demand_index NUMERIC,
ADD COLUMN IF NOT EXISTS forecast_confidence TEXT,
ADD COLUMN IF NOT EXISTS monthly_forecasts_enhanced JSONB;