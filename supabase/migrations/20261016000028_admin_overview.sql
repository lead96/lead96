-- M5: admin view across all businesses (platform admins only).
--
-- admin_business_overview(): one row per business: owners, setup, last 30 days (leads, AI calls,
-- booked, won, revenue), what waits on the business (open review items, visits / jobs without a
-- result), data health problems, failures in the last 7 days and last activity.
-- admin_error_feed(): the latest failures of every kind in one list: AI calls that errored, call
-- jobs that failed, emails / texts that failed, webhook deliveries that failed.

create or replace function public.admin_business_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d30 timestamptz := now() - interval '30 days';
  d7 timestamptz := now() - interval '7 days';
  d90 timestamptz := now() - interval '90 days';
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.last_activity desc nulls last)
    from (
      select w.id, w.name, w.created_at, w.setup_completed_at,
        (select string_agg(p.email, ', ' order by m.created_at) from public.workspace_members m join public.profiles p on p.id = m.user_id
          where m.workspace_id = w.id and m.role = 'owner') as owners,
        (select count(*) from public.workspace_members m where m.workspace_id = w.id)::int as members,
        (select count(*) from public.leads l where l.workspace_id = w.id and l.received_at >= d30)::int as leads_30d,
        (select count(*) from public.calls c where c.workspace_id = w.id and c.created_at >= d30 and c.trigger <> 'test')::int as calls_30d,
        (select count(*) from public.appointments a where a.workspace_id = w.id and a.created_at >= d30 and a.status <> 'cancelled')::int as booked_30d,
        (select count(*) from public.customers c where c.workspace_id = w.id and c.status = 'won' and c.closed_at >= d30)::int as won_30d,
        (select coalesce(sum(c.revenue), 0) from public.customers c where c.workspace_id = w.id and c.status = 'won' and c.closed_at >= d30) as revenue_30d,
        (select count(*) from public.review_items r where r.workspace_id = w.id and r.status = 'open')::int as open_reviews,
        (select visits + jobs from public.pending_outcome_counts(w.id)) as pending_outcomes,
        (select count(*) from jsonb_each_text(public.data_health(w.id, d90)) h
          where h.key <> 'lead_no_consent' and h.value::int > 0)::int as health_problems,
        (public.data_health(w.id, d90) ->> 'contact_no_consent')::int as contact_no_consent,
        ((select count(*) from public.calls c where c.workspace_id = w.id and c.created_at >= d7 and c.status = 'error')
         + (select count(*) from public.call_jobs j where j.workspace_id = w.id and j.updated_at >= d7 and j.status = 'failed')
         + (select count(*) from public.notification_jobs n where n.workspace_id = w.id and n.updated_at >= d7 and n.status = 'failed')
         + (select count(*) from public.messages s where s.workspace_id = w.id and s.created_at >= d7 and s.status = 'failed')
         + (select count(*) from public.webhook_deliveries d where d.workspace_id = w.id and d.received_at >= d7 and d.status = 'failed'))::int as errors_7d,
        greatest(
          (select max(l.received_at) from public.leads l where l.workspace_id = w.id),
          (select max(c.created_at) from public.calls c where c.workspace_id = w.id),
          (select max(e.created_at) from public.events e where e.workspace_id = w.id)) as last_activity
      from public.workspaces w
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_business_overview() from public, anon;
grant execute on function public.admin_business_overview() to authenticated;

create or replace function public.admin_error_feed(p_limit int default 100)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(f) order by f.at desc)
    from (
      select * from (
        select 'call' as kind, c.created_at as at, c.workspace_id, c.id::text as ref, c.customer_id,
               coalesce(c.error, c.disconnection_reason, 'Call failed') as message
        from public.calls c where c.status = 'error'
        union all
        select 'call_job', j.updated_at, j.workspace_id, j.id::text, j.customer_id, coalesce(j.reason, 'Call job failed')
        from public.call_jobs j where j.status = 'failed'
        union all
        select 'email', n.updated_at, n.workspace_id, n.id::text, null, n.kind || ': ' || coalesce(n.error, 'failed')
        from public.notification_jobs n where n.status = 'failed'
        union all
        select 'text', s.created_at, s.workspace_id, s.id::text, s.customer_id, coalesce(s.error, 'Text failed')
        from public.messages s where s.status = 'failed'
        union all
        select 'webhook', d.received_at, d.workspace_id, d.id::text, null, d.provider || ': ' || coalesce(d.error, 'failed')
        from public.webhook_deliveries d where d.status = 'failed'
      ) u
      order by at desc
      limit least(greatest(p_limit, 1), 500)
    ) f
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_error_feed(int) from public, anon;
grant execute on function public.admin_error_feed(int) to authenticated;
