-- Add future_monthly_averages column to property_compset_summary table
-- This stores pre-calculated monthly averages from future rates data
ALTER TABLE public.property_compset_summary
ADD COLUMN IF NOT EXISTS future_monthly_averages jsonb DEFAULT NULL;