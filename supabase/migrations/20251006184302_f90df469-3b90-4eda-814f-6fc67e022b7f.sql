-- Add archived column to listings table
ALTER TABLE public.listings 
ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- Create index for better query performance
CREATE INDEX idx_listings_archived ON public.listings(archived) WHERE archived = false;