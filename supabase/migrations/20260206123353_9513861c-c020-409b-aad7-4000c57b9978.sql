-- Add retry tracking columns to nightly_sync_runs
ALTER TABLE nightly_sync_runs 
ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS retry_of uuid REFERENCES nightly_sync_runs(id);

-- Add comment for documentation
COMMENT ON COLUMN nightly_sync_runs.retry_count IS 'Number of retry attempts for this run';
COMMENT ON COLUMN nightly_sync_runs.retry_of IS 'Reference to original run if this is a retry attempt';