-- Add columns to store live Airbnb rating data scraped from the website
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_airbnb_rating numeric(3,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_airbnb_review_count integer;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_rating_scraped_at timestamptz;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS live_rating_scrape_error text;