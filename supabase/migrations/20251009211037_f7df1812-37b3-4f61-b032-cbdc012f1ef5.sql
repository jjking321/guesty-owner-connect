-- Create forecast generation progress tracking table
CREATE TABLE IF NOT EXISTS public.forecast_generation_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  total_forecasts INTEGER NOT NULL,
  completed_forecasts INTEGER DEFAULT 0,
  failed_forecasts INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed'
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.forecast_generation_progress ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own progress
CREATE POLICY "Users can view their own progress"
  ON public.forecast_generation_progress
  FOR SELECT
  USING (auth.uid() = created_by);

-- Create index for faster lookups
CREATE INDEX idx_forecast_progress_status ON public.forecast_generation_progress(status, started_at DESC);