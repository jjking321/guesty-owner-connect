-- Add settings for nightly sync optional features
ALTER TABLE public.guesty_accounts 
ADD COLUMN IF NOT EXISTS airbnb_scrape_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS forecast_generation_enabled boolean DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN public.guesty_accounts.airbnb_scrape_enabled IS 'Whether to include Airbnb ratings scraping in nightly sync';
COMMENT ON COLUMN public.guesty_accounts.forecast_generation_enabled IS 'Whether to include forecast regeneration in nightly sync';