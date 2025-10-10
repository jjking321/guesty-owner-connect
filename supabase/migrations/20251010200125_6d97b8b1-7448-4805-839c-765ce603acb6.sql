-- Add pictures column to listings table to store full array of images from Guesty
ALTER TABLE listings 
ADD COLUMN pictures JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN listings.pictures IS 'Array of picture objects from Guesty with thumbnail, regular, and original URLs';