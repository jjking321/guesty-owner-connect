-- Create table to track nightly sync orchestration runs
CREATE TABLE public.nightly_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  current_step text NOT NULL DEFAULT 'INIT',
  status text NOT NULL DEFAULT 'running',
  account_ids text[] NOT NULL DEFAULT '{}',
  account_states jsonb NOT NULL DEFAULT '{}',
  step_results jsonb NOT NULL DEFAULT '{}',
  error_message text,
  invocation_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add index for finding active runs
CREATE INDEX idx_nightly_sync_runs_status ON public.nightly_sync_runs(status);
CREATE INDEX idx_nightly_sync_runs_started_at ON public.nightly_sync_runs(started_at DESC);

-- Enable RLS
ALTER TABLE public.nightly_sync_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role has full access to nightly_sync_runs"
ON public.nightly_sync_runs
FOR ALL
USING (true)
WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.nightly_sync_runs IS 'Tracks nightly sync orchestration state for self-invocation pattern';