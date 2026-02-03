-- Drop the existing check constraint and add the new sync type including all existing types
ALTER TABLE public.sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_sync_type_check;

ALTER TABLE public.sync_jobs ADD CONSTRAINT sync_jobs_sync_type_check 
CHECK (sync_type IN ('listings', 'reservations', 'owners', 'reviews', 'calendar', 'capacity_calendar', 'goal_recalculation', 'new_reservations', 'airbnb_ratings'));