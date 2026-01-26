-- Create guesty_oauth_tokens table for shared token caching
CREATE TABLE public.guesty_oauth_tokens (
  guesty_account_id uuid PRIMARY KEY REFERENCES public.guesty_accounts(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  oauth_cooldown_until timestamptz NULL,
  refresh_in_progress boolean NOT NULL DEFAULT false,
  refresh_started_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS but do NOT add any SELECT policies for regular users
-- Edge functions use service-role so they can still read/write
ALTER TABLE public.guesty_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- No policies = no access for authenticated users via anon/authenticated roles
-- Only service_role (used by edge functions) can access this table

-- Add comment for documentation
COMMENT ON TABLE public.guesty_oauth_tokens IS 'Server-side OAuth token cache for Guesty API. Only accessible via service role (edge functions).';