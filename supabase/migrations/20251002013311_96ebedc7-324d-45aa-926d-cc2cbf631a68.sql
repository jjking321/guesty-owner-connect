-- Drop the existing table if it exists
DROP TABLE IF EXISTS public.property_goals CASCADE;

-- Create property_goals table for tracking revenue goals
CREATE TABLE public.property_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  budget_revenue NUMERIC DEFAULT 0,
  projection_revenue NUMERIC DEFAULT 0,
  goal_revenue NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(listing_id, year, month)
);

-- Enable RLS
ALTER TABLE public.property_goals ENABLE ROW LEVEL SECURITY;

-- Create policies for property_goals
CREATE POLICY "Users can view goals for their listings"
ON public.property_goals
FOR SELECT
USING (
  listing_id IN (
    SELECT id FROM public.listings
    WHERE guesty_account_id IN (
      SELECT id FROM public.guesty_accounts
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can insert goals for their listings"
ON public.property_goals
FOR INSERT
WITH CHECK (
  listing_id IN (
    SELECT id FROM public.listings
    WHERE guesty_account_id IN (
      SELECT id FROM public.guesty_accounts
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can update goals for their listings"
ON public.property_goals
FOR UPDATE
USING (
  listing_id IN (
    SELECT id FROM public.listings
    WHERE guesty_account_id IN (
      SELECT id FROM public.guesty_accounts
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY "Users can delete goals for their listings"
ON public.property_goals
FOR DELETE
USING (
  listing_id IN (
    SELECT id FROM public.listings
    WHERE guesty_account_id IN (
      SELECT id FROM public.guesty_accounts
      WHERE user_id = auth.uid()
    )
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_property_goals_updated_at
BEFORE UPDATE ON public.property_goals
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create index for faster lookups
CREATE INDEX idx_property_goals_listing_year ON public.property_goals(listing_id, year);
CREATE INDEX idx_property_goals_listing_year_month ON public.property_goals(listing_id, year, month);