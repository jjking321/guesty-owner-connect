-- Add locking columns to property_goals table
ALTER TABLE public.property_goals
ADD COLUMN locked boolean DEFAULT false NOT NULL,
ADD COLUMN locked_at timestamp with time zone,
ADD COLUMN locked_by uuid REFERENCES public.profiles(id);

-- Create index for faster queries on locked goals
CREATE INDEX idx_property_goals_locked ON public.property_goals(locked) WHERE locked = true;

-- Create trigger function to automatically set locked_at and locked_by
CREATE OR REPLACE FUNCTION public.handle_goal_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When locking a goal (locked changes from false to true)
  IF NEW.locked = true AND (OLD.locked IS NULL OR OLD.locked = false) THEN
    NEW.locked_at = now();
    NEW.locked_by = auth.uid();
  END IF;
  
  -- When unlocking a goal (locked changes from true to false)
  IF NEW.locked = false AND OLD.locked = true THEN
    NEW.locked_at = NULL;
    NEW.locked_by = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on property_goals
CREATE TRIGGER on_property_goal_lock
  BEFORE UPDATE ON public.property_goals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_goal_lock();