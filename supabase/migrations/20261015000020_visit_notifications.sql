-- M4: visit confirmations and reminders.
--
-- notification_jobs = one planned message about a visit: confirmation, 24 h and 2 h reminders, moved,
--                     cancelled (to the customer) and "new visit booked" (to the business owners).
-- A trigger on appointments plans them, so every way of booking (AI call, team, later Google) gets
-- them; moving a visit replaces its reminders, cancelling drops them. The per-minute runner
-- (call_runner_tick, migration 013) now also wakes the app when a message is due.
-- Channel "email" now; "sms" once US SMS registration is approved.

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  kind text not null check (kind in ('confirmation', 'reminder_24h', 'reminder_2h', 'rescheduled', 'cancelled', 'team_new_booking')),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'sent', 'skipped', 'failed', 'cancelled')),
  attempt int not null default 0,
  error text,
  sent_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_jobs_due_idx on public.notification_jobs (run_at) where status = 'queued';
create index notification_jobs_appointment_idx on public.notification_jobs (appointment_id);

alter table public.notification_jobs enable row level security;
create policy notification_jobs_select on public.notification_jobs for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

create or replace function public.plan_visit_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notification_jobs (workspace_id, appointment_id, kind, run_at) values
      (new.workspace_id, new.id, 'confirmation', now()),
      (new.workspace_id, new.id, 'team_new_booking', now());
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.notification_jobs set status = 'cancelled', updated_at = now()
    where appointment_id = new.id and status = 'queued' and kind in ('reminder_24h', 'reminder_2h', 'confirmation', 'rescheduled');
    insert into public.notification_jobs (workspace_id, appointment_id, kind, run_at) values (new.workspace_id, new.id, 'cancelled', now());
    return new;
  elsif new.starts_at is distinct from old.starts_at then
    update public.notification_jobs set status = 'cancelled', updated_at = now()
    where appointment_id = new.id and status = 'queued' and kind in ('reminder_24h', 'reminder_2h');
    insert into public.notification_jobs (workspace_id, appointment_id, kind, run_at) values (new.workspace_id, new.id, 'rescheduled', now());
  else
    return new;
  end if;

  -- Reminders only when there is still time for them.
  if new.starts_at - interval '24 hours' > now() + interval '10 minutes' then
    insert into public.notification_jobs (workspace_id, appointment_id, kind, run_at) values (new.workspace_id, new.id, 'reminder_24h', new.starts_at - interval '24 hours');
  end if;
  if new.starts_at - interval '2 hours' > now() + interval '10 minutes' then
    insert into public.notification_jobs (workspace_id, appointment_id, kind, run_at) values (new.workspace_id, new.id, 'reminder_2h', new.starts_at - interval '2 hours');
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_visit_notifications() from public, anon, authenticated;

create trigger plan_visit_notifications after insert or update of starts_at, status on public.appointments
  for each row execute function public.plan_visit_notifications();

create or replace function public.claim_notification_jobs(p_limit int default 20)
returns setof public.notification_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_jobs set status = 'queued', updated_at = now()
  where status = 'running' and updated_at < now() - interval '10 minutes';

  return query
  update public.notification_jobs j set status = 'running', attempt = j.attempt + 1, updated_at = now()
  where j.id in (
    select id from public.notification_jobs
    where status = 'queued' and run_at <= now()
    order by run_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  returning j.*;
end;
$$;
revoke execute on function public.claim_notification_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(int) to service_role;

-- The per-minute runner now also wakes the app for due visit messages.
create or replace function public.call_runner_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.call_jobs where status = 'queued' and run_at <= now())
     and not exists (select 1 from public.notification_jobs where status = 'queued' and run_at <= now()) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'lead96_call_runner_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lead96_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public.call_runner_tick() from public, anon, authenticated;
