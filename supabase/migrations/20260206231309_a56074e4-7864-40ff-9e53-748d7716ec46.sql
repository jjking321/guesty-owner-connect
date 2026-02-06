-- Create dispute analysis progress table for tracking batch analysis
CREATE TABLE public.dispute_analysis_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  status text NOT NULL DEFAULT 'running',
  total_reviews integer NOT NULL DEFAULT 0,
  completed_reviews integer NOT NULL DEFAULT 0,
  failed_reviews integer NOT NULL DEFAULT 0,
  skipped_reviews integer NOT NULL DEFAULT 0,
  current_guest_name text,
  error_message text,
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.dispute_analysis_progress ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role has full access"
  ON public.dispute_analysis_progress
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users can view progress
CREATE POLICY "Authenticated users can view progress"
  ON public.dispute_analysis_progress
  FOR SELECT
  TO authenticated
  USING (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispute_analysis_progress;