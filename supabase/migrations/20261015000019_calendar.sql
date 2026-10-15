-- M4: Lead96's own calendar. Appointments are arrival windows ("Thu 8am-12pm") inside the
-- business's visit hours; capacity comes from the setup (jobs per day, spread over the windows).
--
-- appointments       = booked visits (AI call, AI text or the team). Written only through the
--                      functions below, which re-check capacity under a per-business lock so two
--                      callers can never take the last place at the same moment.
-- calendar_blackouts = days the business does not take visits (holidays, vacation).

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  call_id uuid references public.calls (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled')),
  source text not null check (source in ('ai_call', 'ai_text', 'manual')),
  service text,
  address text,
  notes text,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_workspace_idx on public.appointments (workspace_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);

create table public.calendar_blackouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index calendar_blackouts_workspace_idx on public.calendar_blackouts (workspace_id, starts_on);

alter table public.calls add column appointment_id uuid references public.appointments (id) on delete set null;

alter table public.appointments enable row level security;
alter table public.calendar_blackouts enable row level security;
create policy appointments_select on public.appointments for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy blackouts_select on public.calendar_blackouts for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy blackouts_insert on public.calendar_blackouts for insert to authenticated
  with check (public.is_owner(workspace_id));
create policy blackouts_delete on public.calendar_blackouts for delete to authenticated
  using (public.is_owner(workspace_id));

-- Change history for the new tables (migration 018).
create trigger log_change after insert or update or delete on public.appointments
  for each row execute function public.log_change('workspace_id', 'id');
create trigger log_change after insert or update or delete on public.calendar_blackouts
  for each row execute function public.log_change('workspace_id', 'id');

-- Signed-in callers must be members of the business; the server (service role) may book for anyone.
create or replace function public.calendar_guard(p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_member(p_workspace) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.calendar_guard(uuid) from public, anon;

-- Capacity check under the business's lock. Raises P0001 'full' / 'day_full' / 'blocked'.
create or replace function public.calendar_check(p_workspace uuid, p_starts timestamptz, p_ends timestamptz, p_window_cap int, p_day_cap int, p_tz text, p_ignore uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  local_day date := (p_starts at time zone p_tz)::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar:' || p_workspace::text, 0));
  if exists (select 1 from public.calendar_blackouts b where b.workspace_id = p_workspace and local_day between b.starts_on and b.ends_on) then
    raise exception 'blocked' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments a
      where a.workspace_id = p_workspace and a.status <> 'cancelled' and a.id is distinct from p_ignore
        and a.starts_at < p_ends and a.ends_at > p_starts) >= greatest(p_window_cap, 1) then
    raise exception 'full' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments a
      where a.workspace_id = p_workspace and a.status <> 'cancelled' and a.id is distinct from p_ignore
        and (a.starts_at at time zone p_tz)::date = local_day) >= greatest(p_day_cap, 1) then
    raise exception 'day_full' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.calendar_check(uuid, timestamptz, timestamptz, int, int, text, uuid) from public, anon, authenticated;

create or replace function public.book_window(
  p_workspace uuid, p_starts timestamptz, p_ends timestamptz, p_window_cap int, p_day_cap int, p_tz text,
  p_customer uuid default null, p_lead uuid default null, p_call uuid default null, p_source text default 'manual',
  p_service text default null, p_address text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  appt uuid;
  cur text;
  label text := to_char(p_starts at time zone p_tz, 'Dy Mon FMDD, FMHH12:MIam') || ' - ' || to_char(p_ends at time zone p_tz, 'FMHH12:MIam');
begin
  perform public.calendar_guard(p_workspace);
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and workspace_id = p_workspace) then
    raise exception 'customer not in this business' using errcode = '42501';
  end if;
  perform public.calendar_check(p_workspace, p_starts, p_ends, p_window_cap, p_day_cap, p_tz, null);

  insert into public.appointments (workspace_id, customer_id, lead_id, call_id, starts_at, ends_at, source, service, address, notes, created_by)
  values (p_workspace, p_customer, p_lead, p_call, p_starts, p_ends, p_source, p_service, left(p_address, 300), left(p_notes, 1000), auth.uid())
  returning id into appt;
  if p_call is not null then
    update public.calls set appointment_id = appt where id = p_call and workspace_id = p_workspace;
  end if;

  if p_customer is not null then
    insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
    values (p_workspace, 'appointment.booked', 'appointments', appt, p_customer, auth.uid(),
            jsonb_build_object('label', label, 'starts_at', p_starts, 'ends_at', p_ends, 'source', p_source, 'address', p_address));
    select status into cur from public.customers where id = p_customer;
    if cur in ('new', 'contacted', 'qualified') then
      update public.customers set status = 'appointment', updated_at = now() where id = p_customer;
      insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
      values (p_workspace, 'customer.status_changed', 'customers', p_customer, p_customer, auth.uid(),
              jsonb_build_object('from', cur, 'to', 'appointment', 'reason', 'Visit booked: ' || label));
    end if;
  end if;
  return appt;
end;
$$;
revoke execute on function public.book_window(uuid, timestamptz, timestamptz, int, int, text, uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.book_window(uuid, timestamptz, timestamptz, int, int, text, uuid, uuid, uuid, text, text, text, text) to authenticated, service_role;

-- Move a visit to another window (same capacity rules, not counting itself).
create or replace function public.reschedule_appointment(p_id uuid, p_starts timestamptz, p_ends timestamptz, p_window_cap int, p_day_cap int, p_tz text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  select * into a from public.appointments where id = p_id;
  if a.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform public.calendar_guard(a.workspace_id);
  if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'closed' using errcode = 'P0001'; end if;
  perform public.calendar_check(a.workspace_id, p_starts, p_ends, p_window_cap, p_day_cap, p_tz, p_id);
  update public.appointments set starts_at = p_starts, ends_at = p_ends, status = 'scheduled', updated_at = now() where id = p_id;
  if a.customer_id is not null then
    insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
    values (a.workspace_id, 'appointment.rescheduled', 'appointments', p_id, a.customer_id, auth.uid(),
            jsonb_build_object('label', to_char(p_starts at time zone p_tz, 'Dy Mon FMDD, FMHH12:MIam') || ' - ' || to_char(p_ends at time zone p_tz, 'FMHH12:MIam'),
                               'from', a.starts_at, 'to', p_starts));
  end if;
end;
$$;
revoke execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz, int, int, text) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz, int, int, text) to authenticated, service_role;

-- Confirm / complete / no-show / cancel. Showing up or not moves the customer on.
create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  cur text;
  nxt text;
begin
  if p_status not in ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  select * into a from public.appointments where id = p_id;
  if a.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform public.calendar_guard(a.workspace_id);
  update public.appointments
  set status = p_status, cancel_reason = case when p_status = 'cancelled' then left(p_reason, 300) else cancel_reason end, updated_at = now()
  where id = p_id;
  if a.customer_id is not null then
    insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
    values (a.workspace_id, 'appointment.' || p_status, 'appointments', p_id, a.customer_id, auth.uid(), jsonb_build_object('reason', p_reason));
    select status into cur from public.customers where id = a.customer_id;
    nxt := case when p_status = 'completed' and cur in ('appointment', 'qualified', 'contacted', 'new') then 'showed'
                when p_status = 'cancelled' and cur = 'appointment' then 'qualified' end;
    if nxt is not null then
      update public.customers set status = nxt, updated_at = now() where id = a.customer_id;
      insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
      values (a.workspace_id, 'customer.status_changed', 'customers', a.customer_id, a.customer_id, auth.uid(),
              jsonb_build_object('from', cur, 'to', nxt, 'reason', case when p_status = 'completed' then 'Visit done' else 'Visit cancelled' end));
    end if;
  end if;
end;
$$;
revoke execute on function public.set_appointment_status(uuid, text, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text, text) to authenticated, service_role;
