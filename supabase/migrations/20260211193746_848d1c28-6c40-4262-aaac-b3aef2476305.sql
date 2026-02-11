CREATE INDEX IF NOT EXISTS idx_booking_probabilities_calculated_at_desc 
ON public.booking_probabilities (calculated_at DESC NULLS LAST)
WHERE calculated_at IS NOT NULL;