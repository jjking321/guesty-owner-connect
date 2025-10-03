-- Add last_synced_offset column to sync_jobs table to enable resumable syncs
ALTER TABLE sync_jobs 
ADD COLUMN last_synced_offset integer DEFAULT 0;