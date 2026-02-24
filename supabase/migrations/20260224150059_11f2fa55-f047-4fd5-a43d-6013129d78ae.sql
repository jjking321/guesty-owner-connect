
ALTER TABLE public.sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_sync_type_check;
ALTER TABLE public.sync_jobs ADD CONSTRAINT sync_jobs_sync_type_check CHECK (
  sync_type IN ('listings', 'reservations', 'reviews', 'new_reservations', 'capacity_calendar', 'comparable_historical', 'comparable_future_rates', 'airbnb_ratings', 'new_reviews', 'goal_recalculation', 'backfill_taxes')
);
