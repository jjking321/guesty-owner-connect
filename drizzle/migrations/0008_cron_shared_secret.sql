CREATE TABLE IF NOT EXISTS public.cron_secrets (
  name text PRIMARY KEY,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.cron_secrets FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.cron_secrets TO service_role;
ALTER TABLE public.cron_secrets ENABLE ROW LEVEL SECURITY;
INSERT INTO public.cron_secrets(name) VALUES ('nightly') ON CONFLICT DO NOTHING;

SELECT cron.schedule('nightly-guesty-sync', '0 3 * * *', $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg',
      'x-cron-secret',(SELECT token FROM public.cron_secrets WHERE name='nightly')),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('nightly-sync-verify', '30 5 * * *', $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg',
      'x-cron-secret',(SELECT token FROM public.cron_secrets WHERE name='nightly')),
    body := '{"verify": true}'::jsonb);
$$);