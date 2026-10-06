-- Profiles are created by the on_auth_user_created trigger. Users who signed up
-- before the schema existed (e.g. a freshly created project used before
-- `db push`) have no profile row. Create any that are missing. Safe to re-run.
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name'
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id);
