-- Add tracking columns for automated nightly sync
ALTER TABLE guesty_accounts
ADD COLUMN IF NOT EXISTS last_automated_sync TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS automated_sync_enabled BOOLEAN DEFAULT true;