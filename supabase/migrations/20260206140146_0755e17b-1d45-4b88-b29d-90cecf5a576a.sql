-- Add columns for red flag exclusions and analysis context
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS dispute_redflags_excluded JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS dispute_analysis_context TEXT;