-- Add airbnb_listing_id column to listings table
ALTER TABLE public.listings 
ADD COLUMN airbnb_listing_id TEXT;