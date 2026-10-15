-- M5: dashboard numbers by channel.
--
-- lead_channel(): where a lead really came from. A landing page lead with a Google click ID or
-- utm_source=google is a Google Ads lead (it is what the ad money bought); same for Meta.
--
-- dashboard_report(): customers whose FIRST contact falls in the period (a cohort), grouped by the
-- channel of that first lead, and how far each got. A stage counts if the customer reached it at any
-- time, so a job later lost still counts as booked / showed:
--   qualified = qualified or any later stage (lost means a qualified job that was not won), or a visit
--   booked    = a visit that was not cancelled, or status appointment or later
--   showed    = a visit marked done, or status showed / estimate / won
--   won       = status won; revenue = revenue of won jobs
-- plus ad spend per platform for the same days. Runs as the caller, so row-level security applies.

create or replace function public.lead_channel(p_source text, p_gclid text, p_fbclid text, p_utm_source text)
returns text
language sql immutable as $$
  select case
    when p_source = 'google' or p_gclid is not null or coalesce(p_utm_source, '') ~* '(google|adwords)' then 'google_ads'
    when p_source = 'meta' or p_fbclid is not null or coalesce(p_utm_source, '') ~* '^(fb|facebook|meta|instagram|ig)$' then 'meta_ads'
    else p_source
  end;
$$;

create or replace function public.dashboard_report(p_workspace uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with cohort as (
    select cu.id, cu.status, cu.revenue,
           coalesce((select public.lead_channel(l.source, l.gclid, l.fbclid, l.utm_source)
                       from public.leads l where l.customer_id = cu.id order by l.received_at, l.id limit 1), 'manual') as channel,
           exists (select 1 from public.appointments a where a.customer_id = cu.id and a.status <> 'cancelled') as has_visit,
           exists (select 1 from public.appointments a where a.customer_id = cu.id and a.status = 'completed') as has_showed
    from public.customers cu
    where cu.workspace_id = p_workspace and cu.merged_into is null
      and cu.first_lead_at >= p_from and cu.first_lead_at < p_to
  ), staged as (
    select channel, status, revenue,
           status in ('qualified', 'appointment', 'showed', 'estimate', 'won', 'lost') or has_visit as qualified,
           has_visit or status in ('appointment', 'showed', 'estimate', 'won') as booked,
           has_showed or status in ('showed', 'estimate', 'won') as showed
    from cohort
  ), channels as (
    select channel,
           count(*)::int as leads,
           count(*) filter (where qualified)::int as qualified,
           count(*) filter (where booked)::int as booked,
           count(*) filter (where showed)::int as showed,
           count(*) filter (where status = 'won')::int as won,
           count(*) filter (where status = 'lost')::int as lost,
           count(*) filter (where status = 'not_qualified')::int as not_qualified,
           coalesce(sum(revenue) filter (where status = 'won'), 0) as revenue
    from staged group by channel
  ), spend as (
    select platform, sum(cost) as cost, sum(clicks)::int as clicks, min(currency) as currency
    from public.ad_spend_daily
    where workspace_id = p_workspace and date >= p_from_date and date <= p_to_date
    group by platform
  )
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(to_jsonb(c) order by c.leads desc) from channels c), '[]'::jsonb),
    'spend', coalesce((select jsonb_agg(to_jsonb(s)) from spend s), '[]'::jsonb)
  );
$$;
revoke execute on function public.dashboard_report(uuid, timestamptz, timestamptz, date, date) from public, anon;
grant execute on function public.dashboard_report(uuid, timestamptz, timestamptz, date, date) to authenticated, service_role;
