-- The functions gateway requires an Authorization header in addition to apikey.
-- Re-schedule all HTTP cron jobs with both headers set to the publishable (anon) key.

SELECT cron.schedule(
  'nightly-guesty-sync',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'nightly-sync-verify',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
    body := '{"verify": true}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'weekly-revenue-forecasts',
  '0 2 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/generate-all-forecasts',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
    body := '{"trigger": "cron"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'nightly-dispute-analysis',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/batch-analyze-disputes',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
    body := '{"limit": 50, "maxAgeDays": 7, "skipWithoutReservation": true}'::jsonb
  );
  $$
);
