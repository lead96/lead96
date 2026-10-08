-- M2: CSV import (bulk ingest) + call-intake webhook log.
--
-- ingest_leads(p jsonb[])  = ingest_lead() for up to 500 rows in one round trip. Each row runs in
--                            its own savepoint, so one bad row is reported instead of failing the batch.
-- webhook_deliveries       = one row per accepted webhook delivery (call intake now; Meta/Google later),
--                            with outcome, attempt count and the raw payload for replay. Feeds
--                            integration health in Admin.

-- ---------------------------------------------------------------------------
-- Bulk ingest
-- ---------------------------------------------------------------------------
create function public.ingest_leads(p jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  results jsonb := '[]';
  r jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'array required'; end if;
  if jsonb_array_length(p) > 500 then raise exception 'too_many_rows'; end if;
  for item in select e.value from jsonb_array_elements(p) with ordinality as e (value, n) order by e.n loop
    begin
      r := public.ingest_lead(item);
    exception when others then
      r := jsonb_build_object('error', sqlerrm);
    end;
    results := results || jsonb_build_array(r);
  end loop;
  return results;
end;
$$;

revoke execute on function public.ingest_leads(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_leads(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Webhook deliveries
-- ---------------------------------------------------------------------------
create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('call', 'meta', 'google')),
  external_id text,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  status text not null check (status in ('processed', 'duplicate', 'rejected', 'failed')),
  error text,
  lead_id uuid references public.leads (id) on delete set null,
  attempt int not null default 1,      -- 2+ = the sender retried this delivery
  payload jsonb,                       -- raw body, for debugging and replay
  received_at timestamptz not null default now()
);
create index webhook_deliveries_provider_idx on public.webhook_deliveries (provider, received_at desc);
create index webhook_deliveries_workspace_idx on public.webhook_deliveries (workspace_id, received_at desc);
create index webhook_deliveries_external_idx on public.webhook_deliveries (provider, external_id);

alter table public.webhook_deliveries enable row level security;

-- Written by the service role only. Owners see their workspace's deliveries; platform admins see all.
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (public.is_owner(workspace_id) or public.is_platform_admin());
