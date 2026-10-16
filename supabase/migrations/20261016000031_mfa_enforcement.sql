-- M6: two-factor sign-in (TOTP), enforced in the database.
--
-- A user who turned on two-factor must have entered a code in this session (JWT aal = 'aal2') before
-- any business data is readable or writable. The app also sends them to the code page, but the app
-- check reads the session cookie; this one reads the signed JWT and auth.mfa_factors, so a stolen
-- password alone can't read data even by calling the database directly.
--
-- mfa_ok() is added to the four helpers every RLS policy and security-definer function goes
-- through (is_member, is_owner, is_platform_admin, shares_workspace). Users without two-factor and
-- the server (service role, no auth.uid()) are unaffected.

create or replace function public.mfa_ok()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

create or replace function public.is_member(ws uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(ws uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.shares_workspace(other uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mfa_ok() and exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- The one policy that doesn't go through a helper: users editing their own profile.
create policy profiles_update_mfa on public.profiles as restrictive for update to authenticated
  using (public.mfa_ok());
