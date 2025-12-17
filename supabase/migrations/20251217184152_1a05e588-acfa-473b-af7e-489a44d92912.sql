-- Add columns to store future rates data
ALTER TABLE property_comparables
ADD COLUMN IF NOT EXISTS future_rates JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS future_rates_fetched_at TIMESTAMPTZ DEFAULT NULL;