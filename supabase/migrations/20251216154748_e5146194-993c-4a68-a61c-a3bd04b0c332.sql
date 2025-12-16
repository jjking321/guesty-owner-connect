-- Add unique constraint for upsert operations on property_goals
ALTER TABLE public.property_goals 
ADD CONSTRAINT property_goals_listing_year_month_unique 
UNIQUE (listing_id, year, month);