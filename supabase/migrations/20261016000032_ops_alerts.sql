-- M6: failure alerts by email to the platform admins.
--
-- Every hour (pg_cron, minute 5) plan_ops_alert() collects what failed since the last alert:
-- AI calls with an error, failed call jobs, failed emails and texts, failed webhook deliveries,
-- Google Ads syncs that ended in an error, the Google sign-in failing, and work that is overdue
-- (call jobs or messages still queued 15+ minutes after their time - the runner is not keeping up).
-- If anything is there it queues one ops_alerts row; the per-minute runner (call_runner_tick ->
-- /api/cron/calls) emails it. At most one alert per hour; nothing is sent when nothing failed.
-- Limit: if the app or the runner itself is down, this can't send either (an outside monitor covers that).

create table public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  window_from timestamptz not null,
  window_to timestamptz not null,
  counts jsonb not null,
  examples jsonb not null default '[]',
  status text not null default 'queued' check (status in ('queued', 'running', 'sent', 'skipped', 'failed')),
  attempt int not null default 0,
  error text,
  sent_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ops_alerts_window_idx on public.ops_alerts (window_to desc);

alter table public.ops_alerts enable row level security;
create policy ops_alerts_select on public.ops_alerts for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete, truncate on public.ops_alerts from anon, authenticated;

-- What failed between two moments: counts per kind and up to 8 recent examples.
create or replace function public.ops_failures(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select 'AI call' as kind, c.created_at as at, c.workspace_id, coalesce(c.error, c.disconnection_reason, 'call failed') as message
      from public.calls c where c.status = 'error' and c.created_at >= p_from and c.created_at < p_to
    union all
    select 'Call job', j.updated_at, j.workspace_id, coalesce(j.reason, 'failed')
      from public.call_jobs j where j.status = 'failed' and j.updated_at >= p_from and j.updated_at < p_to
    union all
    select 'Email', n.updated_at, n.workspace_id, n.kind || ': ' || coalesce(n.error, 'failed')
      from public.notification_jobs n where n.status = 'failed' and n.updated_at >= p_from and n.updated_at < p_to
    union all
    select 'Text', s.updated_at, s.workspace_id, coalesce(s.error, 'failed')
      from public.messages s where s.status = 'failed' and s.updated_at >= p_from and s.updated_at < p_to
    union all
    select 'Webhook', d.received_at, d.workspace_id, d.provider || ': ' || coalesce(d.error, 'failed')
      from public.webhook_deliveries d where d.status = 'failed' and d.received_at >= p_from and d.received_at < p_to
    union all
    select 'Google Ads sync', a.last_sync_at, a.workspace_id, coalesce(a.last_sync_error, 'sync failed')
      from public.ad_accounts a where a.last_sync_status = 'error' and a.last_sync_at >= p_from and a.last_sync_at < p_to
    union all
    select 'Google sign-in', p.last_error_at, null, coalesce(p.last_error, 'failed')
      from public.platform_connections p where p.last_error_at >= p_from and p.last_error_at < p_to
        and (p.last_ok_at is null or p.last_ok_at < p.last_error_at)
    union all
    select 'Overdue call job', j.run_at, j.workspace_id, 'still queued ' || round(extract(epoch from (p_to - j.run_at)) / 60) || ' min after its time'
      from public.call_jobs j where j.status = 'queued' and j.run_at < p_to - interval '15 minutes'
    union all
    select 'Overdue message', n.run_at, n.workspace_id, n.kind || ' still queued ' || round(extract(epoch from (p_to - n.run_at)) / 60) || ' min after its time'
      from public.notification_jobs n where n.status = 'queued' and n.run_at < p_to - interval '15 minutes'
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) as n from f group by kind) k), '{}'::jsonb),
    'examples', coalesce((select jsonb_agg(e) from (
      select f.kind, f.at, left(f.message, 200) as message, w.name as business
      from f left join public.workspaces w on w.id = f.workspace_id
      order by f.at desc limit 8) e), '[]'::jsonb)
  );
$$;
revoke execute on function public.ops_failures(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ops_failures(timestamptz, timestamptz) to service_role;

create or replace function public.plan_ops_alert()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce((select max(window_to) from public.ops_alerts), now() - interval '1 hour');
  v_to timestamptz := now();
  r jsonb;
begin
  if v_to - v_from < interval '50 minutes' then return 0; end if;
  r := public.ops_failures(v_from, v_to);
  if r -> 'counts' = '{}'::jsonb then
    -- Nothing failed: remember the window so the next one starts here (kept for the record).
    insert into public.ops_alerts (window_from, window_to, counts, status) values (v_from, v_to, '{}', 'skipped');
    return 0;
  end if;
  insert into public.ops_alerts (window_from, window_to, counts, examples) values (v_from, v_to, r -> 'counts', r -> 'examples');
  return 1;
end;
$$;
revoke execute on function public.plan_ops_alert() from public, anon, authenticated;
grant execute on function public.plan_ops_alert() to service_role;

create or replace function public.claim_ops_alerts()
returns setof public.ops_alerts
language plpgsql security definer set search_path = public as $$
begin
  update public.ops_alerts set status = 'queued', updated_at = now()
  where status = 'running' and updated_at < now() - interval '10 minutes';
  return query
  update public.ops_alerts a set status = 'running', attempt = a.attempt + 1, updated_at = now()
  where a.id in (select id from public.ops_alerts where status = 'queued' order by created_at limit 5 for update skip locked)
  returning a.*;
end;
$$;
revoke execute on function public.claim_ops_alerts() from public, anon, authenticated;
grant execute on function public.claim_ops_alerts() to service_role;

-- The per-minute runner also wakes the app for a queued alert.
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
     and not exists (select 1 from public.notification_jobs where status = 'queued' and run_at <= now())
     and not exists (select 1 from public.ops_alerts where status = 'queued') then
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

select cron.schedule('lead96-ops-alerts', '5 * * * *', 'select public.plan_ops_alert()');
