-- Create sync_jobs table to track sync progress
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guesty_account_id UUID NOT NULL REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('listings', 'reservations')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  progress_message TEXT,
  items_synced INTEGER DEFAULT 0,
  total_items INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Enable RLS on sync_jobs
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

-- Sync jobs policies
CREATE POLICY "Users can view own sync jobs"
  ON public.sync_jobs FOR SELECT
  USING (
    guesty_account_id IN (
      SELECT id FROM public.guesty_accounts WHERE user_id = auth.uid()
    )
  );

-- Enable realtime for sync_jobs table
ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_jobs;

-- Add last_listings_sync and last_reservations_sync columns to guesty_accounts
ALTER TABLE public.guesty_accounts 
  ADD COLUMN last_listings_sync TIMESTAMPTZ,
  ADD COLUMN last_reservations_sync TIMESTAMPTZ;

-- Drop the old last_sync_at column
ALTER TABLE public.guesty_accounts DROP COLUMN IF EXISTS last_sync_at;