-- 1. Create credentials table
CREATE TABLE public.guesty_account_credentials (
  guesty_account_id uuid PRIMARY KEY REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. Enable RLS with NO policies (service role bypasses RLS)
ALTER TABLE public.guesty_account_credentials ENABLE ROW LEVEL SECURITY;

-- 3. Defense in depth: explicitly revoke from anon/authenticated
REVOKE ALL ON public.guesty_account_credentials FROM anon, authenticated;

-- 4. Backfill from existing guesty_accounts rows
INSERT INTO public.guesty_account_credentials (guesty_account_id, client_id, client_secret, created_at, updated_at)
SELECT id, client_id, client_secret, now(), now()
FROM public.guesty_accounts
ON CONFLICT (guesty_account_id) DO NOTHING;

-- 5. Drop the now-redundant columns from guesty_accounts
ALTER TABLE public.guesty_accounts DROP COLUMN client_id;
ALTER TABLE public.guesty_accounts DROP COLUMN client_secret;

-- 6. Auto-update updated_at
CREATE TRIGGER update_guesty_account_credentials_updated_at
BEFORE UPDATE ON public.guesty_account_credentials
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();