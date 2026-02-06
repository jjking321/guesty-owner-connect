-- Add columns for conversation red flag analysis
ALTER TABLE public.reviews 
ADD COLUMN IF NOT EXISTS dispute_conversation_redflags JSONB,
ADD COLUMN IF NOT EXISTS dispute_conversation_analyzed_at TIMESTAMPTZ;