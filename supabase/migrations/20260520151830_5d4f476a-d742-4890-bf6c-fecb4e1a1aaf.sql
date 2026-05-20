CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invite RECORD;
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);

  -- Auto-accept any pending, non-expired invitation matching this email
  FOR _invite IN
    SELECT id, organization_id, role
    FROM public.organization_invitations
    WHERE lower(email) = lower(NEW.email)
      AND accepted_at IS NULL
      AND expires_at > now()
  LOOP
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (_invite.organization_id, NEW.id, _invite.role)
    ON CONFLICT DO NOTHING;

    UPDATE public.organization_invitations
    SET accepted_at = now()
    WHERE id = _invite.id;
  END LOOP;

  RETURN NEW;
END;
$$;