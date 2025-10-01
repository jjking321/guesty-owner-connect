-- Update guesty_accounts table to use client_id and client_secret instead of api_token
ALTER TABLE public.guesty_accounts 
  DROP COLUMN api_token;

ALTER TABLE public.guesty_accounts 
  ADD COLUMN client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN client_secret TEXT NOT NULL DEFAULT '';

-- Remove the default after adding the columns
ALTER TABLE public.guesty_accounts 
  ALTER COLUMN client_id DROP DEFAULT,
  ALTER COLUMN client_secret DROP DEFAULT;