-- M3: automatic calls to new leads (fast callback) and retries.
--
-- call_jobs = one planned AI call to a lead: due now (fast callback), later (outside calling hours)
--             or a retry after no answer. Written by the server only; members read.
-- A per-minute pg_cron job asks the app to run due jobs. It posts only when something is due,
-- and only once the URL and secret exist in Vault (set once per environment, never in git):
--   select vault.create_secret('https://lead96.com/api/cron/calls', 'lead96_call_runner_url');
--   select vault.create_secret('<CRON_SECRET>', 'lead96_cron_secret');

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.call_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  trigger text not null check (trigger in ('fast_callback', 'retry', 'manual')),
  attempt int not null default 1 check (attempt between 1 and 10),
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'skipped', 'failed', 'cancelled')),
  reason text,
  call_id uuid references public.calls (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index call_jobs_due_idx on public.call_jobs (run_at) where status = 'queued';
create index call_jobs_workspace_idx on public.call_jobs (workspace_id, created_at desc);
-- At most one open (queued or running) job per customer: duplicate leads never cause two calls.
create unique index call_jobs_open_uidx on public.call_jobs (customer_id) where status in ('queued', 'running');

alter table public.call_jobs enable row level security;
create policy call_jobs_select on public.call_jobs for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

alter table public.calls add column job_id uuid references public.call_jobs (id) on delete set null;

-- Claims due jobs atomically (running), so overlapping runners never place the same call twice.
-- Jobs stuck in running for 10 minutes (crashed runner) go back to the queue first.
create or replace function public.claim_call_jobs(p_limit int default 10)
returns setof public.call_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.call_jobs set status = 'queued', updated_at = now()
  where status = 'running' and updated_at < now() - interval '10 minutes';

  return query
  update public.call_jobs j set status = 'running', updated_at = now()
  where j.id in (
    select id from public.call_jobs
    where status = 'queued' and run_at <= now()
    order by run_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning j.*;
end;
$$;
revoke execute on function public.claim_call_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_call_jobs(int) to service_role;

-- Called by pg_cron every minute. Posts to the app only when a job is due and Vault has the target.
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
  if not exists (select 1 from public.call_jobs where status = 'queued' and run_at <= now()) then
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

select cron.schedule('lead96-call-runner', '* * * * *', 'select public.call_runner_tick()');
