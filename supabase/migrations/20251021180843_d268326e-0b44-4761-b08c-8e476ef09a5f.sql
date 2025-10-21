-- Create function to automatically sync reservation_nights when reservations change
CREATE OR REPLACE FUNCTION sync_reservation_nights_for_reservation()
RETURNS TRIGGER AS $$
DECLARE
  current_night DATE;
  revenue_per_night NUMERIC;
BEGIN
  -- Only process confirmed/checked_in/checked_out reservations
  IF NEW.status NOT IN ('confirmed', 'checked_in', 'checked_out') THEN
    -- Delete any existing nights for cancelled reservations
    DELETE FROM reservation_nights WHERE reservation_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Skip if missing critical data
  IF NEW.check_in IS NULL OR NEW.check_out IS NULL OR NEW.nights_count IS NULL OR NEW.nights_count <= 0 THEN
    RETURN NEW;
  END IF;

  -- Calculate revenue per night
  revenue_per_night := COALESCE(NEW.fare_accommodation_adjusted, 0) / NEW.nights_count;

  -- Delete old nights for this reservation
  DELETE FROM reservation_nights WHERE reservation_id = NEW.id;

  -- Generate night records
  current_night := NEW.check_in;
  WHILE current_night < NEW.check_out LOOP
    INSERT INTO reservation_nights (reservation_id, listing_id, night_date, revenue_allocation)
    VALUES (NEW.id, NEW.listing_id, current_night, revenue_per_night)
    ON CONFLICT (reservation_id, night_date) DO UPDATE
    SET revenue_allocation = EXCLUDED.revenue_allocation,
        listing_id = EXCLUDED.listing_id;
    
    current_night := current_night + INTERVAL '1 day';
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically sync reservation_nights
DROP TRIGGER IF EXISTS sync_nights_on_reservation_change ON reservations;
CREATE TRIGGER sync_nights_on_reservation_change
AFTER INSERT OR UPDATE ON reservations
FOR EACH ROW
EXECUTE FUNCTION sync_reservation_nights_for_reservation();

-- Backfill existing data by triggering the function for all confirmed reservations
UPDATE reservations SET updated_at = updated_at
WHERE status IN ('confirmed', 'checked_in', 'checked_out')
  AND check_in IS NOT NULL
  AND check_out IS NOT NULL
  AND nights_count > 0;