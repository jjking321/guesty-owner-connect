-- Add 'reviews' to the sync_type check constraint
ALTER TABLE sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_sync_type_check;
ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_sync_type_check 
  CHECK (sync_type IN ('listings', 'reservations', 'owners', 'reviews'));