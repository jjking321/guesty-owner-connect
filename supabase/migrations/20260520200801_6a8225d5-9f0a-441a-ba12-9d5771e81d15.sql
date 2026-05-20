CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _invite RECORD;
  _accepted_count int := 0;
  _new_org_id uuid;
  _org_name text;
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);

  -- Auto-accept any pending, non-expired invitations matching this email
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

    _accepted_count := _accepted_count + 1;
  END LOOP;

  -- If no invitations were accepted, create a new organization and make them admin
  IF _accepted_count = 0 THEN
    _org_name := COALESCE(split_part(NEW.email, '@', 1), 'My Organization');
    INSERT INTO public.organizations (name)
    VALUES (_org_name)
    RETURNING id INTO _new_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (_new_org_id, NEW.id, 'admin'::member_role);

    UPDATE public.profiles
    SET active_organization_id = _new_org_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;