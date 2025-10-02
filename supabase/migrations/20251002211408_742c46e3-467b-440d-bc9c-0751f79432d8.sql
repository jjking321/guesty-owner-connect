-- Add parent_group_id to property_groups for hierarchical groups
ALTER TABLE property_groups
ADD COLUMN parent_group_id uuid REFERENCES property_groups(id) ON DELETE CASCADE;

-- Create index for better query performance
CREATE INDEX idx_property_groups_parent ON property_groups(parent_group_id);

-- Update RLS policies to handle nested groups
-- Users can view groups and their sub-groups
DROP POLICY IF EXISTS "Users can view own groups" ON property_groups;
CREATE POLICY "Users can view own groups" ON property_groups
FOR SELECT USING (
  auth.uid() = user_id OR
  parent_group_id IN (
    SELECT id FROM property_groups WHERE user_id = auth.uid()
  )
);

-- Users can create sub-groups under their own groups
DROP POLICY IF EXISTS "Users can insert own groups" ON property_groups;
CREATE POLICY "Users can insert own groups" ON property_groups
FOR INSERT WITH CHECK (
  auth.uid() = user_id AND (
    parent_group_id IS NULL OR
    parent_group_id IN (
      SELECT id FROM property_groups WHERE user_id = auth.uid()
    )
  )
);

-- Users can update their own groups and sub-groups
DROP POLICY IF EXISTS "Users can update own groups" ON property_groups;
CREATE POLICY "Users can update own groups" ON property_groups
FOR UPDATE USING (
  auth.uid() = user_id OR
  parent_group_id IN (
    SELECT id FROM property_groups WHERE user_id = auth.uid()
  )
);

-- Users can delete their own groups and sub-groups
DROP POLICY IF EXISTS "Users can delete own groups" ON property_groups;
CREATE POLICY "Users can delete own groups" ON property_groups
FOR DELETE USING (
  auth.uid() = user_id OR
  parent_group_id IN (
    SELECT id FROM property_groups WHERE user_id = auth.uid()
  )
);