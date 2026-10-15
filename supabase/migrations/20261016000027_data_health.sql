-- M5: data health, plus merging duplicate customers.
--
-- data_health(p_workspace, p_since) counts what is missing or wrong; data_health_list() lists up to
-- 100 rows of one check. Both run as the caller (row-level security applies). Checks:
--   missing_source       ad / landing page / website leads without campaign data (utm, click ID, campaign)
--   missing_transcript   answered AI calls (over 10 s, a real conversation) without a transcript
--   duplicates           "possible duplicate" pairs still both live and not marked as different people
--   visit_no_outcome     visits whose time has passed, still booked or confirmed (any age)
--   won_no_revenue       won jobs without revenue (any age)
--   contact_no_consent   AI calls out or texts to people with no consent on any of their leads; must be 0
--   lead_no_consent      leads without consent (information: the AI does not call or text them)
--
-- merge_customers(p_keep, p_merge) moves everything of one customer to the other and marks it merged.
-- dismiss_duplicate() records that two customers are different people.

create or replace function public.data_health(p_workspace uuid, p_since timestamptz)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'missing_source', (select count(*) from public.leads l where l.workspace_id = p_workspace and l.received_at >= p_since
                         and l.source in ('landing_page', 'meta', 'google', 'website') and not l.attribution_complete),
    'missing_transcript', (select count(*) from public.calls c where c.workspace_id = p_workspace and c.created_at >= p_since
                             and c.trigger <> 'test' and c.status = 'ended' and coalesce(c.duration_seconds, 0) > 10
                             and coalesce(c.outcome, '') not in ('no_answer', 'voicemail') and c.transcript is null),
    'duplicates', (select count(*) from (
                     select distinct least(e.customer_id, (e.payload ->> 'other_customer_id')::uuid), greatest(e.customer_id, (e.payload ->> 'other_customer_id')::uuid)
                     from public.events e
                     join public.customers a on a.id = e.customer_id and a.merged_into is null
                     join public.customers b on b.id = (e.payload ->> 'other_customer_id')::uuid and b.merged_into is null
                     where e.workspace_id = p_workspace and e.type = 'customer.possible_duplicate'
                       and not exists (select 1 from public.events d where d.workspace_id = p_workspace and d.type = 'customer.not_duplicate'
                                         and ((d.customer_id = a.id and (d.payload ->> 'other_customer_id')::uuid = b.id)
                                           or (d.customer_id = b.id and (d.payload ->> 'other_customer_id')::uuid = a.id)))) x),
    'visit_no_outcome', (select count(*) from public.appointments a where a.workspace_id = p_workspace
                           and a.status in ('scheduled', 'confirmed') and a.ends_at < now() - interval '1 hour'),
    'won_no_revenue', (select count(*) from public.customers c where c.workspace_id = p_workspace and c.merged_into is null
                         and c.status = 'won' and c.revenue is null),
    'contact_no_consent', (select count(distinct x.customer_id) from (
                             select c.customer_id from public.calls c where c.workspace_id = p_workspace and c.created_at >= p_since
                               and c.trigger <> 'test' and c.direction = 'outbound' and c.customer_id is not null
                             union all
                             select m.customer_id from public.messages m where m.workspace_id = p_workspace and m.created_at >= p_since
                               and m.reason <> 'inbound' and m.status in ('sent', 'ongoing', 'ended') and m.customer_id is not null) x
                           where not exists (select 1 from public.leads l where l.customer_id = x.customer_id and l.consent_given)),
    'lead_no_consent', (select count(*) from public.leads l where l.workspace_id = p_workspace and l.received_at >= p_since and not l.consent_given)
  );
$$;
revoke execute on function public.data_health(uuid, timestamptz) from public, anon;
grant execute on function public.data_health(uuid, timestamptz) to authenticated, service_role;

-- Rows: customer_id, other_customer_id (duplicates), call_id, appointment_id, lead_id, at, detail.
create or replace function public.data_health_list(p_workspace uuid, p_check text, p_since timestamptz)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  out jsonb;
begin
  if p_check = 'missing_source' then
    select jsonb_agg(r) into out from (
      select l.customer_id, l.id as lead_id, l.received_at as at, l.source as detail from public.leads l
      where l.workspace_id = p_workspace and l.received_at >= p_since and l.source in ('landing_page', 'meta', 'google', 'website')
        and not l.attribution_complete order by l.received_at desc limit 100) r;
  elsif p_check = 'missing_transcript' then
    select jsonb_agg(r) into out from (
      select c.customer_id, c.id as call_id, c.created_at as at, c.outcome as detail from public.calls c
      where c.workspace_id = p_workspace and c.created_at >= p_since and c.trigger <> 'test' and c.status = 'ended'
        and coalesce(c.duration_seconds, 0) > 10 and coalesce(c.outcome, '') not in ('no_answer', 'voicemail') and c.transcript is null
      order by c.created_at desc limit 100) r;
  elsif p_check = 'duplicates' then
    select jsonb_agg(r) into out from (
      select distinct on (least(a.id, b.id), greatest(a.id, b.id)) a.id as customer_id, b.id as other_customer_id, e.created_at as at,
             e.payload ->> 'reason' as detail
      from public.events e
      join public.customers a on a.id = e.customer_id and a.merged_into is null
      join public.customers b on b.id = (e.payload ->> 'other_customer_id')::uuid and b.merged_into is null
      where e.workspace_id = p_workspace and e.type = 'customer.possible_duplicate'
        and not exists (select 1 from public.events d where d.workspace_id = p_workspace and d.type = 'customer.not_duplicate'
                          and ((d.customer_id = a.id and (d.payload ->> 'other_customer_id')::uuid = b.id)
                            or (d.customer_id = b.id and (d.payload ->> 'other_customer_id')::uuid = a.id)))
      order by least(a.id, b.id), greatest(a.id, b.id), e.created_at desc limit 100) r;
  elsif p_check = 'visit_no_outcome' then
    select jsonb_agg(r) into out from (
      select a.customer_id, a.id as appointment_id, a.starts_at as at, a.status as detail from public.appointments a
      where a.workspace_id = p_workspace and a.status in ('scheduled', 'confirmed') and a.ends_at < now() - interval '1 hour'
      order by a.starts_at limit 100) r;
  elsif p_check = 'won_no_revenue' then
    select jsonb_agg(r) into out from (
      select c.id as customer_id, coalesce(c.closed_at, c.updated_at) as at, null as detail from public.customers c
      where c.workspace_id = p_workspace and c.merged_into is null and c.status = 'won' and c.revenue is null
      order by c.updated_at desc limit 100) r;
  elsif p_check = 'contact_no_consent' then
    select jsonb_agg(r) into out from (
      select x.customer_id, max(x.at) as at, string_agg(distinct x.kind, ', ') as detail from (
        select c.customer_id, c.created_at as at, 'AI call' as kind from public.calls c where c.workspace_id = p_workspace
          and c.created_at >= p_since and c.trigger <> 'test' and c.direction = 'outbound' and c.customer_id is not null
        union all
        select m.customer_id, m.created_at, 'text' from public.messages m where m.workspace_id = p_workspace and m.created_at >= p_since
          and m.reason <> 'inbound' and m.status in ('sent', 'ongoing', 'ended') and m.customer_id is not null) x
      where not exists (select 1 from public.leads l where l.customer_id = x.customer_id and l.consent_given)
      group by x.customer_id order by max(x.at) desc limit 100) r;
  elsif p_check = 'lead_no_consent' then
    select jsonb_agg(r) into out from (
      select l.customer_id, l.id as lead_id, l.received_at as at, l.source as detail from public.leads l
      where l.workspace_id = p_workspace and l.received_at >= p_since and not l.consent_given
      order by l.received_at desc limit 100) r;
  else
    raise exception 'unknown check' using errcode = '22023';
  end if;
  return coalesce(out, '[]'::jsonb);
end;
$$;
revoke execute on function public.data_health_list(uuid, text, timestamptz) from public, anon;
grant execute on function public.data_health_list(uuid, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Duplicates
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_duplicate(p_customer uuid, p_other uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.customers where id = p_customer;
  if ws is null or not public.is_member(ws) or not exists (select 1 from public.customers where id = p_other and workspace_id = ws) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (ws, 'customer.not_duplicate', 'customers', p_customer, p_customer, auth.uid(), jsonb_build_object('other_customer_id', p_other));
end;
$$;
revoke execute on function public.dismiss_duplicate(uuid, uuid) from public, anon;
grant execute on function public.dismiss_duplicate(uuid, uuid) to authenticated;

-- Moves leads, calls, visits, texts, call jobs and review items of p_merge to p_keep, fills the
-- keeper's blanks, keeps the further status (won wins), keeps "do not call" if either has it, and
-- marks p_merge as merged (it stays, hidden, so its history and events remain readable).
create or replace function public.merge_customers(p_keep uuid, p_merge uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k public.customers;
  m public.customers;
  rank_k int;
  rank_m int;
  best public.customers;
begin
  if p_keep = p_merge then raise exception 'same customer' using errcode = '22023'; end if;
  -- Lock both in a fixed order so two merges can't deadlock.
  perform 1 from public.customers where id in (p_keep, p_merge) order by id for update;
  select * into k from public.customers where id = p_keep;
  select * into m from public.customers where id = p_merge;
  if k.id is null or m.id is null or k.workspace_id <> m.workspace_id or not public.is_member(k.workspace_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if k.merged_into is not null or m.merged_into is not null then raise exception 'already merged' using errcode = '22023'; end if;

  -- One open call job per customer: the merged customer's open job is cancelled.
  update public.call_jobs set status = 'cancelled', reason = 'Customer merged', updated_at = now()
  where customer_id = p_merge and status in ('queued', 'running');
  -- One open item per customer and kind: the merged customer's duplicates are closed.
  update public.review_items r set status = 'rejected', reason = 'Customer merged', reviewed_at = now()
  where r.customer_id = p_merge and r.call_id is null and r.status in ('open', 'unsure')
    and exists (select 1 from public.review_items o where o.customer_id = p_keep and o.kind = r.kind and o.call_id is null and o.status in ('open', 'unsure'));

  update public.leads set customer_id = p_keep where customer_id = p_merge;
  update public.calls set customer_id = p_keep where customer_id = p_merge;
  update public.call_jobs set customer_id = p_keep where customer_id = p_merge;
  update public.messages set customer_id = p_keep where customer_id = p_merge;
  update public.appointments set customer_id = p_keep where customer_id = p_merge;
  update public.review_items set customer_id = p_keep where customer_id = p_merge;

  -- Free the phone / email first (they are unique among live customers).
  update public.customers set merged_into = p_keep, updated_at = now() where id = p_merge;

  rank_k := array_position(array['new', 'contacted', 'not_qualified', 'qualified', 'lost', 'appointment', 'showed', 'estimate', 'won'], k.status);
  rank_m := array_position(array['new', 'contacted', 'not_qualified', 'qualified', 'lost', 'appointment', 'showed', 'estimate', 'won'], m.status);
  best := case when rank_m > rank_k then m else k end;

  update public.customers set
    full_name = coalesce(k.full_name, m.full_name),
    phone = coalesce(k.phone, m.phone),
    email = coalesce(k.email, m.email),
    zip = coalesce(k.zip, m.zip),
    address = coalesce(k.address, m.address),
    service = coalesce(k.service, m.service),
    first_source = case when m.first_lead_at < k.first_lead_at or k.first_lead_at is null then coalesce(m.first_source, k.first_source) else k.first_source end,
    first_lead_at = least(k.first_lead_at, m.first_lead_at),
    last_lead_at = greatest(k.last_lead_at, m.last_lead_at),
    lead_count = k.lead_count + m.lead_count,
    notes = nullif(concat_ws(E'\n\n', k.notes, m.notes), ''),
    do_not_call = k.do_not_call or m.do_not_call,
    status = best.status,
    not_qualified_reason = best.not_qualified_reason,
    lost_reason = best.lost_reason,
    estimate_amount = coalesce(best.estimate_amount, k.estimate_amount, m.estimate_amount),
    revenue = best.revenue,
    closed_at = best.closed_at,
    updated_at = now()
  where id = p_keep;

  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload) values
    (k.workspace_id, 'customer.merged', 'customers', p_keep, p_keep, auth.uid(),
     jsonb_strip_nulls(jsonb_build_object('merged_customer_id', p_merge, 'name', coalesce(m.full_name, m.phone, m.email)))),
    (k.workspace_id, 'customer.merged', 'customers', p_merge, p_merge, auth.uid(),
     jsonb_strip_nulls(jsonb_build_object('merged_into', p_keep, 'name', coalesce(k.full_name, k.phone, k.email))));
end;
$$;
revoke execute on function public.merge_customers(uuid, uuid) from public, anon;
grant execute on function public.merge_customers(uuid, uuid) to authenticated;
