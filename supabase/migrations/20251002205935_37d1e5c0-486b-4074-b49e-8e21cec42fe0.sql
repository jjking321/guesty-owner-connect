-- Create property_groups table
CREATE TABLE public.property_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create junction table for group memberships
CREATE TABLE public.property_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.property_groups(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(group_id, listing_id)
);

-- Enable RLS
ALTER TABLE public.property_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_group_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies for property_groups
CREATE POLICY "Users can view own groups"
  ON public.property_groups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own groups"
  ON public.property_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own groups"
  ON public.property_groups FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own groups"
  ON public.property_groups FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for property_group_members
CREATE POLICY "Users can view members of their groups"
  ON public.property_group_members FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM public.property_groups WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert members to their groups"
  ON public.property_group_members FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT id FROM public.property_groups WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete members from their groups"
  ON public.property_group_members FOR DELETE
  USING (
    group_id IN (
      SELECT id FROM public.property_groups WHERE user_id = auth.uid()
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_property_groups_updated_at
  BEFORE UPDATE ON public.property_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();