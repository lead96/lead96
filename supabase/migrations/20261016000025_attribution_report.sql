-- M5: attribution views. The dashboard cohort (migration 024) broken down by the first lead's
-- campaign, landing page, ad or keyword instead of the channel.
--
-- cohort_funnel(): one row per customer whose first contact is in the period, with their first
-- lead and the stages reached (same rules as dashboard_report). attribution_report() groups it by
-- the chosen dimension and also returns ad spend per campaign for the same days; the app matches
-- campaign spend to rows (by campaign ID, or by name for landing page leads that only carry
-- utm_campaign). Ad, keyword and landing page rows have no spend (spend is synced per campaign).

create or replace function public.cohort_funnel(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (customer_id uuid, status text, revenue numeric, lead_id uuid, qualified boolean, booked boolean, showed boolean)
language sql stable security invoker set search_path = public as $$
  select cu.id, cu.status, cu.revenue,
         (select l.id from public.leads l where l.customer_id = cu.id order by l.received_at, l.id limit 1),
         cu.status in ('qualified', 'appointment', 'showed', 'estimate', 'won', 'lost') or v.has_visit,
         v.has_visit or cu.status in ('appointment', 'showed', 'estimate', 'won'),
         v.has_showed or cu.status in ('showed', 'estimate', 'won')
  from public.customers cu
  cross join lateral (
    select exists (select 1 from public.appointments a where a.customer_id = cu.id and a.status <> 'cancelled') as has_visit,
           exists (select 1 from public.appointments a where a.customer_id = cu.id and a.status = 'completed') as has_showed
  ) v
  where cu.workspace_id = p_workspace and cu.merged_into is null
    and cu.first_lead_at >= p_from and cu.first_lead_at < p_to;
$$;
revoke execute on function public.cohort_funnel(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.cohort_funnel(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- p_dim: 'campaign' | 'landing_page' | 'ad' | 'keyword'. Rows: channel, key (null = not known), label.
create or replace function public.attribution_report(p_workspace uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date, p_dim text)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with f as (
    select c.*, l.source, l.gclid, l.fbclid, l.utm_source,
           public.lead_channel(l.source, l.gclid, l.fbclid, l.utm_source) as channel,
           case p_dim
             when 'campaign' then coalesce(nullif(l.campaign_id, ''), nullif(l.utm_campaign, ''))
             when 'landing_page' then l.landing_page_id::text
             when 'ad' then coalesce(nullif(l.ad_id, ''), nullif(l.utm_content, ''))
             when 'keyword' then lower(trim(coalesce(nullif(l.keyword, ''), nullif(l.utm_term, ''))))
           end as key,
           case p_dim
             when 'campaign' then coalesce(nullif(l.campaign_name, ''), nullif(l.utm_campaign, ''), l.campaign_id)
             when 'landing_page' then (select lp.name from public.landing_pages lp where lp.id = l.landing_page_id)
             when 'ad' then coalesce(nullif(l.ad_name, ''), nullif(l.utm_content, ''), l.ad_id)
             when 'keyword' then lower(trim(coalesce(nullif(l.keyword, ''), nullif(l.utm_term, ''))))
           end as label
    from public.cohort_funnel(p_workspace, p_from, p_to) c
    left join public.leads l on l.id = c.lead_id
  ), rows as (
    select coalesce(channel, 'manual') as channel, key, max(label) as label,
           count(*)::int as leads,
           count(*) filter (where qualified)::int as qualified,
           count(*) filter (where booked)::int as booked,
           count(*) filter (where showed)::int as showed,
           count(*) filter (where status = 'won')::int as won,
           count(*) filter (where status = 'lost')::int as lost,
           count(*) filter (where status = 'not_qualified')::int as not_qualified,
           coalesce(sum(revenue) filter (where status = 'won'), 0) as revenue
    from f group by 1, 2
  ), spend as (
    select platform, campaign_id, max(campaign_name) as campaign_name, sum(cost) as cost, sum(clicks)::int as clicks
    from public.ad_spend_daily
    where workspace_id = p_workspace and date >= p_from_date and date <= p_to_date and p_dim = 'campaign'
    group by platform, campaign_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.leads desc, r.label) from rows r), '[]'::jsonb),
    'spend', coalesce((select jsonb_agg(to_jsonb(s) order by s.cost desc) from spend s), '[]'::jsonb)
  )
  where p_dim in ('campaign', 'landing_page', 'ad', 'keyword');
$$;
revoke execute on function public.attribution_report(uuid, timestamptz, timestamptz, date, date, text) from public, anon;
grant execute on function public.attribution_report(uuid, timestamptz, timestamptz, date, date, text) to authenticated, service_role;
