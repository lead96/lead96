-- Invite flow fixes.
-- 1. get_invite(): lets the /invite page show who invited whom *before* sign-in,
--    and explain expired / used / wrong-account cases instead of a generic error.
-- 2. accept_invite(): checks the verified auth email (not the profile copy),
--    raises a specific error code per failure, and is safe to call twice.
-- 3. my_pending_invites(): an invitee who lost the link (or confirmed their
--    email in another tab) still sees the invite after signing in.

-- get_invite: knowing the 192-bit token is the authorization, so anon may call it.
-- Returns no row when the token does not exist (or the invite was revoked).
create function public.get_invite(p_token text)
returns table (
  workspace_name text,
  email text,
  role public.member_role,
  status text,            -- 'valid' | 'expired' | 'accepted'
  already_member boolean  -- the signed-in user is already in this workspace
)
language sql stable security definer set search_path = '' as $$
  select
    w.name,
    i.email,
    i.role,
    case
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end,
    auth.uid() is not null and public.is_member(i.workspace_id)
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.token = p_token;
$$;

-- Error codes (in the exception message) the app maps to friendly text:
--   invite_not_found | invite_expired | invite_used | email_mismatch | email_unverified | not_signed_in
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.workspace_invites;
  me record;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  select * into inv from public.workspace_invites where token = p_token;
  if inv.id is null then
    raise exception 'invite_not_found';
  end if;

  -- Re-opening an invite you already used just takes you to the workspace.
  if inv.accepted_at is not null then
    if public.is_member(inv.workspace_id) then
      return inv.workspace_id;
    end if;
    raise exception 'invite_used';
  end if;

  if inv.expires_at <= now() then
    raise exception 'invite_expired';
  end if;

  select email, email_confirmed_at into me from auth.users where id = auth.uid();
  if me.email_confirmed_at is null then
    raise exception 'email_unverified';
  end if;
  if lower(inv.email) <> lower(me.email) then
    raise exception 'email_mismatch';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict do nothing;

  update public.workspace_invites set accepted_at = now() where id = inv.id;

  insert into public.audit_log (workspace_id, actor_id, action, target)
  values (inv.workspace_id, auth.uid(), 'invite.accept', inv.id::text);

  return inv.workspace_id;
end;
$$;

-- Open invites addressed to the signed-in user's verified email.
create function public.my_pending_invites()
returns table (token text, workspace_name text, role public.member_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.token, w.name, i.role, i.expires_at
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and lower(i.email) = lower(u.email)
    and i.accepted_at is null
    and i.expires_at > now()
    and not public.is_member(i.workspace_id)
  order by i.created_at desc;
$$;

-- Functions are executable by PUBLIC by default; narrow to who needs them.
revoke execute on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

revoke execute on function public.my_pending_invites() from public, anon;
grant execute on function public.my_pending_invites() to authenticated;
