-- Add foreign key constraint from organization_members to profiles
ALTER TABLE public.organization_members
DROP CONSTRAINT IF EXISTS organization_members_user_id_fkey;

ALTER TABLE public.organization_members
ADD CONSTRAINT organization_members_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;