-- Change airroi_listing_id column from bigint to text to prevent JavaScript precision loss
ALTER TABLE property_comparables 
ALTER COLUMN airroi_listing_id TYPE text USING airroi_listing_id::text;

-- Fix existing corrupted IDs by extracting correct values from cover_photo_url
UPDATE property_comparables
SET airroi_listing_id = substring(cover_photo_url from 'Hosting-(\d+)/')
WHERE cover_photo_url ~ 'Hosting-\d+/';