-- Admin: integration health. One call returns everything the Admin page needs, aggregated in the
-- database (no raw rows leave it). Platform admins only.

create index leads_received_idx on public.leads (received_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);
create index usage_records_created_idx on public.usage_records (kind, created_at desc);

create function public.admin_integration_health()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d1 timestamptz := now() - interval '24 hours';
  d7 timestamptz := now() - interval '7 days';
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Webhook deliveries per provider. "no_contact" = a call with blocked caller ID (normal, not a fault).
    'deliveries', coalesce((
      select jsonb_object_agg(provider, stats) from (
        select provider, jsonb_build_object(
          'total', count(*),
          'ok_24h', count(*) filter (where status in ('processed', 'duplicate') and received_at >= d1),
          'ok_7d', count(*) filter (where status in ('processed', 'duplicate') and received_at >= d7),
          'failed_24h', count(*) filter (where status = 'failed' and received_at >= d1),
          'failed_7d', count(*) filter (where status = 'failed' and received_at >= d7),
          'invalid_24h', count(*) filter (where status = 'rejected' and error is distinct from 'no caller number or email' and received_at >= d1),
          'invalid_7d', count(*) filter (where status = 'rejected' and error is distinct from 'no caller number or email' and received_at >= d7),
          'no_contact_7d', count(*) filter (where status = 'rejected' and error = 'no caller number or email' and received_at >= d7),
          'retries_7d', count(*) filter (where attempt > 1 and received_at >= d7),
          'last_ok_at', max(received_at) filter (where status in ('processed', 'duplicate')),
          'last_failed_at', max(received_at) filter (where status = 'failed'),
          'last_invalid_at', max(received_at) filter (where status = 'rejected' and error is distinct from 'no caller number or email')
        ) as stats
        from public.webhook_deliveries
        group by provider
      ) s
    ), '{}'::jsonb),

    -- Most recent problem per provider, with its message.
    'last_problems', coalesce((
      select jsonb_object_agg(provider, jsonb_build_object('at', received_at, 'status', status, 'error', error, 'external_id', external_id))
      from (
        select distinct on (provider) provider, received_at, status, error, external_id
        from public.webhook_deliveries
        where status = 'failed' or (status = 'rejected' and error is distinct from 'no caller number or email')
        order by provider, received_at desc
      ) p
    ), '{}'::jsonb),

    -- Leads per source.
    'leads', coalesce((
      select jsonb_object_agg(source, jsonb_build_object('n_24h', n1, 'n_7d', n7, 'last_at', last_at))
      from (
        select source,
               count(*) filter (where received_at >= d1) as n1,
               count(*) filter (where received_at >= d7) as n7,
               max(received_at) as last_at
        from public.leads
        group by source
      ) l
    ), '{}'::jsonb),

    'imports_7d', (
      select jsonb_build_object(
        'files', count(*),
        'rows', coalesce(sum((metadata ->> 'rows')::int), 0),
        'failed', coalesce(sum((metadata ->> 'failed')::int), 0),
        'last_at', max(created_at))
      from public.audit_log
      where action = 'leads.imported' and created_at >= d7
    ),

    'ai', (
      select jsonb_build_object(
        'calls_24h', count(*) filter (where created_at >= d1),
        'tokens_24h', coalesce(sum(quantity) filter (where created_at >= d1), 0),
        'tokens_7d', coalesce(sum(quantity) filter (where created_at >= d7), 0),
        'last_at', max(created_at))
      from public.usage_records
      where kind = 'ai_tokens'
    ),

    'published_pages', (select count(*) from public.landing_pages where status = 'published'),

    -- Per business, most recently active first.
    'workspaces', coalesce((
      select jsonb_agg(w order by w.last_lead_at desc nulls last, w.created_at desc)
      from (
        select ws.id, ws.name, ws.created_at, ws.setup_completed_at,
               (select count(*) from public.leads l where l.workspace_id = ws.id and l.received_at >= d7) as leads_7d,
               (select max(l.received_at) from public.leads l where l.workspace_id = ws.id) as last_lead_at,
               (select count(*) from public.landing_pages lp where lp.workspace_id = ws.id and lp.status = 'published') as published_pages,
               (select count(*) from public.webhook_deliveries d where d.workspace_id = ws.id and d.received_at >= d7
                  and (d.status = 'failed' or (d.status = 'rejected' and d.error is distinct from 'no caller number or email'))) as problems_7d
        from public.workspaces ws
        order by ws.created_at desc
        limit 500
      ) w
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_integration_health() from public, anon;
grant execute on function public.admin_integration_health() to authenticated;
