-- Add column for private notes from host
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS private_note TEXT;