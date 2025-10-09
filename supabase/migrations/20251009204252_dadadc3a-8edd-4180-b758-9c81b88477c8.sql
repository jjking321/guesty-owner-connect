-- Create booking_curves table to store historical pickup patterns by DBA bucket
CREATE TABLE IF NOT EXISTS public.booking_curves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  dba_bucket TEXT NOT NULL,
  pickup_share NUMERIC NOT NULL DEFAULT 0,
  pickup_amount_mean NUMERIC NOT NULL DEFAULT 0,
  pickup_amount_stddev NUMERIC NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, year_month, dba_bucket)
);

-- Create forecast_settings table for configurable parameters
CREATE TABLE IF NOT EXISTS public.forecast_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  forecast_method TEXT NOT NULL DEFAULT 'additive' CHECK (forecast_method IN ('additive', 'multiplicative')),
  dba_buckets JSONB NOT NULL DEFAULT '[[0,3],[4,7],[8,14],[15,30],[31,60],[61,90],[91,180],[181,365]]'::jsonb,
  min_history_months INTEGER NOT NULL DEFAULT 24,
  smoothing_window_months INTEGER NOT NULL DEFAULT 3,
  pace_clip_min NUMERIC NOT NULL DEFAULT 0.6,
  pace_clip_max NUMERIC NOT NULL DEFAULT 1.4,
  simulation_runs INTEGER NOT NULL DEFAULT 10000,
  fallback_hierarchy JSONB NOT NULL DEFAULT '["property", "bedroom_cohort", "portfolio"]'::jsonb,
  owner_holds_treatment TEXT NOT NULL DEFAULT 'exclude' CHECK (owner_holds_treatment IN ('exclude', 'include')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create capacity_calendar table for availability tracking
CREATE TABLE IF NOT EXISTS public.capacity_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  block_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, date)
);

-- Create reservation_nights table for per-night revenue allocation
CREATE TABLE IF NOT EXISTS public.reservation_nights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id TEXT NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  night_date DATE NOT NULL,
  revenue_allocation NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reservation_id, night_date)
);

-- Create forecast_accuracy table for backtesting metrics
CREATE TABLE IF NOT EXISTS public.forecast_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  target_month TEXT NOT NULL,
  forecast_p50 NUMERIC NOT NULL,
  actual_revenue NUMERIC,
  absolute_error NUMERIC,
  percentage_error NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enhance revenue_forecasts table with new columns
ALTER TABLE public.revenue_forecasts 
  ADD COLUMN IF NOT EXISTS forecast_method TEXT DEFAULT 'additive',
  ADD COLUMN IF NOT EXISTS pace_factor NUMERIC,
  ADD COLUMN IF NOT EXISTS capacity_utilization NUMERIC,
  ADD COLUMN IF NOT EXISTS dba_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS backtest_metrics JSONB;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_booking_curves_listing_month ON public.booking_curves(listing_id, year_month);
CREATE INDEX IF NOT EXISTS idx_capacity_calendar_listing_date ON public.capacity_calendar(listing_id, date);
CREATE INDEX IF NOT EXISTS idx_reservation_nights_listing_date ON public.reservation_nights(listing_id, night_date);
CREATE INDEX IF NOT EXISTS idx_reservation_nights_reservation ON public.reservation_nights(reservation_id);
CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_listing_month ON public.forecast_accuracy(listing_id, target_month);

-- Enable RLS on new tables
ALTER TABLE public.booking_curves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_accuracy ENABLE ROW LEVEL SECURITY;

-- RLS Policies for booking_curves
CREATE POLICY "Users can view booking curves for their listings"
  ON public.booking_curves FOR SELECT
  USING (
    listing_id IN (
      SELECT id FROM public.listings 
      WHERE guesty_account_id IN (
        SELECT guesty_account_id FROM public.guesty_accounts WHERE user_id = auth.uid()
      )
    )
  );

-- RLS Policies for forecast_settings
CREATE POLICY "Users can view forecast settings"
  ON public.forecast_settings FOR SELECT
  USING (true);

CREATE POLICY "Users can insert forecast settings"
  ON public.forecast_settings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update forecast settings"
  ON public.forecast_settings FOR UPDATE
  USING (true);

-- RLS Policies for capacity_calendar
CREATE POLICY "Users can view capacity for their listings"
  ON public.capacity_calendar FOR SELECT
  USING (
    listing_id IN (
      SELECT id FROM public.listings 
      WHERE guesty_account_id IN (
        SELECT guesty_account_id FROM public.guesty_accounts WHERE user_id = auth.uid()
      )
    )
  );

-- RLS Policies for reservation_nights
CREATE POLICY "Users can view reservation nights for their listings"
  ON public.reservation_nights FOR SELECT
  USING (
    listing_id IN (
      SELECT id FROM public.listings 
      WHERE guesty_account_id IN (
        SELECT guesty_account_id FROM public.guesty_accounts WHERE user_id = auth.uid()
      )
    )
  );

-- RLS Policies for forecast_accuracy
CREATE POLICY "Users can view forecast accuracy for their listings"
  ON public.forecast_accuracy FOR SELECT
  USING (
    listing_id IN (
      SELECT id FROM public.listings 
      WHERE guesty_account_id IN (
        SELECT guesty_account_id FROM public.guesty_accounts WHERE user_id = auth.uid()
      )
    )
  );

-- Insert default forecast settings
INSERT INTO public.forecast_settings (
  forecast_method,
  dba_buckets,
  min_history_months,
  smoothing_window_months,
  pace_clip_min,
  pace_clip_max,
  simulation_runs,
  fallback_hierarchy,
  owner_holds_treatment
) VALUES (
  'additive',
  '[[0,3],[4,7],[8,14],[15,30],[31,60],[61,90],[91,180],[181,365]]'::jsonb,
  24,
  3,
  0.6,
  1.4,
  10000,
  '["property", "bedroom_cohort", "portfolio"]'::jsonb,
  'exclude'
) ON CONFLICT DO NOTHING;