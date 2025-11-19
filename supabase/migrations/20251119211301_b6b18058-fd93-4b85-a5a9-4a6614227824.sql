-- Add 'goal_recalculation' to allowed sync_types
ALTER TABLE sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_sync_type_check;

ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_sync_type_check 
CHECK (sync_type IN (
  'listings',
  'reservations', 
  'new_reservations',
  'owners',
  'reviews',
  'capacity_calendar',
  'booking_curves',
  'goal_recalculation'
));