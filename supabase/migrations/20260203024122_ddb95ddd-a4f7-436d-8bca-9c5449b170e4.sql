-- Add probability_calculation_enabled column to guesty_accounts table
ALTER TABLE public.guesty_accounts 
ADD COLUMN IF NOT EXISTS probability_calculation_enabled boolean DEFAULT true;