-- Create revenue_forecasts table to store forecast results
CREATE TABLE public.revenue_forecasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  revenue_on_books NUMERIC NOT NULL,
  forecasted_revenue JSONB NOT NULL,
  total_forecast JSONB NOT NULL,
  goal_probabilities JSONB NOT NULL,
  monthly_forecasts JSONB NOT NULL,
  insights JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(listing_id, year)
);

-- Enable RLS
ALTER TABLE public.revenue_forecasts ENABLE ROW LEVEL SECURITY;

-- Create policies for revenue_forecasts
CREATE POLICY "Users can view forecasts for their listings"
  ON public.revenue_forecasts
  FOR SELECT
  USING (
    listing_id IN (
      SELECT listings.id
      FROM listings
      WHERE listings.guesty_account_id IN (
        SELECT guesty_accounts.id
        FROM guesty_accounts
        WHERE guesty_accounts.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert forecasts for their listings"
  ON public.revenue_forecasts
  FOR INSERT
  WITH CHECK (
    listing_id IN (
      SELECT listings.id
      FROM listings
      WHERE listings.guesty_account_id IN (
        SELECT guesty_accounts.id
        FROM guesty_accounts
        WHERE guesty_accounts.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update forecasts for their listings"
  ON public.revenue_forecasts
  FOR UPDATE
  USING (
    listing_id IN (
      SELECT listings.id
      FROM listings
      WHERE listings.guesty_account_id IN (
        SELECT guesty_accounts.id
        FROM guesty_accounts
        WHERE guesty_accounts.user_id = auth.uid()
      )
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_revenue_forecasts_updated_at
  BEFORE UPDATE ON public.revenue_forecasts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant necessary permissions to pg_cron
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;