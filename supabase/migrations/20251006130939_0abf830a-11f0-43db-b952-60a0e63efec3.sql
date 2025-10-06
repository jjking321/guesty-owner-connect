-- Create organization invitations table (if not exists)
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

-- Enable RLS
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- RLS policies for invitations
DROP POLICY IF EXISTS "Users can view invitations for their organizations" ON public.organization_invitations;
CREATE POLICY "Users can view invitations for their organizations"
ON public.organization_invitations
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id 
    FROM public.organization_members 
    WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Organization owners and admins can insert invitations" ON public.organization_invitations;
CREATE POLICY "Organization owners and admins can insert invitations"
ON public.organization_invitations
FOR INSERT
WITH CHECK (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Organization owners and admins can delete invitations" ON public.organization_invitations;
CREATE POLICY "Organization owners and admins can delete invitations"
ON public.organization_invitations
FOR DELETE
USING (
  public.has_organization_role(organization_id, auth.uid(), 'owner') OR
  public.has_organization_role(organization_id, auth.uid(), 'admin')
);

-- Function to accept invitation and create organization membership
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(_token TEXT, _user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invitation RECORD;
  _result JSONB;
BEGIN
  -- Get invitation details
  SELECT * INTO _invitation
  FROM public.organization_invitations
  WHERE token = _token
    AND accepted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invitation');
  END IF;

  -- Check if user email matches invitation
  IF NOT EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = _user_id 
    AND email = _invitation.email
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email mismatch');
  END IF;

  -- Check if user is already a member
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _invitation.organization_id
    AND user_id = _user_id
  ) THEN
    -- Mark invitation as accepted
    UPDATE public.organization_invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Already a member');
  END IF;

  -- Add user to organization
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (_invitation.organization_id, _user_id, _invitation.role);

  -- Mark invitation as accepted
  UPDATE public.organization_invitations
  SET accepted_at = now()
  WHERE id = _invitation.id;

  RETURN jsonb_build_object('success', true, 'message', 'Invitation accepted');
END;
$$;