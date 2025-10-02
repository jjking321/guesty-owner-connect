-- Set up weekly cron job to generate forecasts for all properties
-- Runs every Monday at 2 AM UTC
SELECT cron.schedule(
  'weekly-revenue-forecasts',
  '0 2 * * 1',
  $$
  SELECT
    net.http_post(
      url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/generate-all-forecasts',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
      body := '{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);