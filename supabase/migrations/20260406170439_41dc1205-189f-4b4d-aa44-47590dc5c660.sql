
ALTER TABLE public.guesty_accounts 
ADD COLUMN IF NOT EXISTS dispute_analysis_enabled boolean DEFAULT false;

ALTER TABLE public.guesty_accounts 
ALTER COLUMN actionables_generation_enabled SET DEFAULT false;
