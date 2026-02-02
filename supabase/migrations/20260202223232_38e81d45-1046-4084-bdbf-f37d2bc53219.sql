-- Add guest_name column to reservations table
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_name TEXT;