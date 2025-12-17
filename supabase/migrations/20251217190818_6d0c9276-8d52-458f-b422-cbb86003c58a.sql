-- Add new columns to capacity_calendar for Guesty calendar data
ALTER TABLE public.capacity_calendar 
ADD COLUMN IF NOT EXISTS price numeric,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS min_nights integer,
ADD COLUMN IF NOT EXISTS status text,
ADD COLUMN IF NOT EXISTS cta boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ctd boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS synced_from_guesty_at timestamp with time zone;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_capacity_calendar_listing_date_range 
ON public.capacity_calendar (listing_id, date);

-- Add comment explaining columns
COMMENT ON COLUMN public.capacity_calendar.price IS 'Nightly rate from Guesty';
COMMENT ON COLUMN public.capacity_calendar.currency IS 'Currency code (default USD)';
COMMENT ON COLUMN public.capacity_calendar.min_nights IS 'Minimum stay requirement';
COMMENT ON COLUMN public.capacity_calendar.status IS 'Guesty status: available, unavailable, booked, reserved';
COMMENT ON COLUMN public.capacity_calendar.cta IS 'Closed to arrival';
COMMENT ON COLUMN public.capacity_calendar.ctd IS 'Closed to departure';
COMMENT ON COLUMN public.capacity_calendar.synced_from_guesty_at IS 'Last sync timestamp from Guesty API';