-- Drop the existing check constraint and add the updated one with 'new_reviews'
ALTER TABLE sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_sync_type_check;

ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_sync_type_check 
CHECK (sync_type = ANY (ARRAY['listings'::text, 'reservations'::text, 'owners'::text, 'reviews'::text, 'calendar'::text, 'capacity_calendar'::text, 'goal_recalculation'::text, 'new_reservations'::text, 'airbnb_ratings'::text, 'new_reviews'::text]));