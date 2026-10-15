-- US texting registration (A2P 10DLC) per business. Retell registers one business profile, brand
-- and campaign per contractor (support answer 2026-10-15), with the contractor's own legal name,
-- EIN, address and website. Retell has no API for it: the owner fills this in under Settings,
-- a platform admin copies it into the Retell dashboard and tracks the review here.
--
-- status: draft (owner editing) -> submitted (owner sent it to Lead96) -> in_review (admin filed it
-- in Retell) -> approved / rejected (admin; a rejected one goes back to the owner to fix).

create table public.texting_registrations (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  legal_name text not null check (length(legal_name) between 2 and 120),
  brand_name text check (length(brand_name) <= 120),
  business_type text not null check (business_type in ('llc', 'corporation', 'partnership', 'sole_proprietor', 'non_profit')),
  ein text not null check (ein ~ '^\d{2}-\d{7}$'),
  website text not null check (length(website) between 4 and 200),
  street text not null check (length(street) between 3 and 160),
  city text not null check (length(city) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  zip text not null check (zip ~ '^\d{5}$'),
  contact_first_name text not null check (length(contact_first_name) between 1 and 60),
  contact_last_name text not null check (length(contact_last_name) between 1 and 60),
  contact_title text not null check (length(contact_title) between 2 and 60),
  contact_email text not null check (length(contact_email) between 5 and 200),
  contact_phone text not null check (contact_phone ~ '^\+1\d{10}$'),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'in_review', 'approved', 'rejected')),
  admin_note text check (length(admin_note) <= 1000),
  submitted_at timestamptz,
  decided_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Holds the EIN: owners and platform admins only, never staff. Writes only through the functions below.
alter table public.texting_registrations enable row level security;
create policy texting_registrations_select on public.texting_registrations for select to authenticated
  using (public.is_owner(workspace_id) or public.is_platform_admin());
revoke insert, update, delete, truncate on public.texting_registrations from anon, authenticated;

-- Change history without the EIN.
create trigger log_change after insert or update or delete on public.texting_registrations
  for each row execute function public.log_change('workspace_id', 'workspace_id', 'ein');

-- Owner saves the details (p_submit = send to Lead96). Only while draft or rejected: once Lead96
-- has it, changes go through Lead96 so the Retell filing and this record never disagree.
create or replace function public.save_texting_registration(p_workspace uuid, p jsonb, p_submit boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_new text := case when p_submit then 'submitted' else 'draft' end;
begin
  if not public.is_owner(p_workspace) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select status into v_status from public.texting_registrations where workspace_id = p_workspace for update;
  if v_status is not null and v_status not in ('draft', 'rejected') then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  insert into public.texting_registrations as t (
    workspace_id, legal_name, brand_name, business_type, ein, website, street, city, state, zip,
    contact_first_name, contact_last_name, contact_title, contact_email, contact_phone,
    status, submitted_at, updated_by, updated_at
  ) values (
    p_workspace, p ->> 'legal_name', nullif(p ->> 'brand_name', ''), p ->> 'business_type', p ->> 'ein', p ->> 'website',
    p ->> 'street', p ->> 'city', p ->> 'state', p ->> 'zip',
    p ->> 'contact_first_name', p ->> 'contact_last_name', p ->> 'contact_title', p ->> 'contact_email', p ->> 'contact_phone',
    v_new, case when p_submit then now() end, auth.uid(), now()
  )
  on conflict (workspace_id) do update set
    legal_name = excluded.legal_name, brand_name = excluded.brand_name, business_type = excluded.business_type,
    ein = excluded.ein, website = excluded.website, street = excluded.street, city = excluded.city,
    state = excluded.state, zip = excluded.zip, contact_first_name = excluded.contact_first_name,
    contact_last_name = excluded.contact_last_name, contact_title = excluded.contact_title,
    contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
    status = excluded.status, submitted_at = excluded.submitted_at, updated_by = excluded.updated_by, updated_at = now();
  return v_new;
end;
$$;
revoke execute on function public.save_texting_registration(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_texting_registration(uuid, jsonb, boolean) to authenticated;

-- Platform admin moves the review along. A note is required when rejecting (the owner sees it).
create or replace function public.set_texting_registration_status(p_workspace uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('in_review', 'approved', 'rejected', 'submitted') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'note required' using errcode = '22023';
  end if;
  update public.texting_registrations
     set status = p_status,
         admin_note = nullif(trim(p_note), ''),
         decided_at = case when p_status in ('approved', 'rejected') then now() else null end,
         updated_by = auth.uid(),
         updated_at = now()
   where workspace_id = p_workspace and status <> 'draft';
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_texting_registration_status(uuid, text, text) from public, anon;
grant execute on function public.set_texting_registration_status(uuid, text, text) to authenticated;
