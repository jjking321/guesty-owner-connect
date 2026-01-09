-- Add columns for dynamic weighting system
ALTER TABLE public.booking_probabilities 
ADD COLUMN IF NOT EXISTS probability_mode text,
ADD COLUMN IF NOT EXISTS historical_monthly_occupancy numeric,
ADD COLUMN IF NOT EXISTS weights_used jsonb;

-- Add comment to explain the modes
COMMENT ON COLUMN public.booking_probabilities.probability_mode IS 'far_out (>90 days or no compset), standard (30-90 days), or close_in (<30 days)';
COMMENT ON COLUMN public.booking_probabilities.historical_monthly_occupancy IS 'Property occupancy for this month last year - used for fallback calculations';
COMMENT ON COLUMN public.booking_probabilities.weights_used IS 'The actual weights applied for this calculation: {compsetDemand, pricePosition, historical, bookingWindow}';