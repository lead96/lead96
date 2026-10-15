-- M5: review queue. Things a person should check, filed automatically:
--
--   from AI calls (trigger on calls; test calls never):
--     low_confidence  the AI was less than 60% sure of its result
--     emergency       the caller described a safety emergency
--     unclear         the AI could not tell the result (outcome "other")
--     call_error      the call failed on the provider side
--     unknown_service the person talked but the AI could not match a service the business offers
--   from outcomes (trigger on customers):
--     disagreement    the real result contradicts the AI: it said not a fit / not interested / wrong
--                     number but the job showed or was won, or it said qualified / booked and the
--                     team marked the lead not qualified
--     high_value      a won job far above the usual (>= $10,000, or 3x the business's average win)
--
-- Each item is resolved once: approve (the AI / value was right), correct (with the right value:
-- call outcome, service or revenue, applied to the record), reject (not usable, e.g. a junk call)
-- or unsure (kept aside for the owner / Lead96). Before / after, reason, reviewer and time are kept;
-- this is the learning record. Members read; writes only through the functions below.

create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('low_confidence', 'emergency', 'unclear', 'call_error', 'unknown_service', 'disagreement', 'high_value')),
  field text not null check (field in ('call_outcome', 'service', 'revenue')),
  call_id uuid references public.calls (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete cascade,
  ai_value text,
  detail jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'approved', 'corrected', 'rejected', 'unsure')),
  before jsonb,
  after jsonb,
  reason text check (length(reason) <= 500),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_items_open_idx on public.review_items (workspace_id, created_at desc) where status in ('open', 'unsure');
create unique index review_items_call_kind_uidx on public.review_items (call_id, kind) where call_id is not null;
create unique index review_items_customer_open_uidx on public.review_items (customer_id, kind) where call_id is null and status in ('open', 'unsure');

alter table public.review_items enable row level security;
create policy review_items_select on public.review_items for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
revoke insert, update, delete, truncate on public.review_items from anon, authenticated;

create trigger log_change after insert or update or delete on public.review_items
  for each row execute function public.log_change('workspace_id', 'id');

-- ---------------------------------------------------------------------------
-- Filing
-- ---------------------------------------------------------------------------
create or replace function public.file_call_reviews()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  spoke boolean := new.outcome in ('qualified', 'booked', 'callback', 'other', 'transferred', 'not_qualified', 'not_interested');
begin
  if new.trigger = 'test' or new.workspace_id is null then return new; end if;
  foreach k in array array[
    case when new.confidence is not null and new.confidence < 0.6 and new.outcome not in ('no_answer', 'voicemail', 'transferred') then 'low_confidence' end,
    case when coalesce(new.analysis ->> 'emergency', '') = 'true' then 'emergency' end,
    case when new.outcome = 'other' then 'unclear' end,
    case when new.status = 'error' then 'call_error' end,
    case when spoke and new.outcome not in ('not_qualified', 'not_interested') and new.analysis ->> 'service' = 'unknown' then 'unknown_service' end
  ] loop
    if k is not null then
      insert into public.review_items (workspace_id, kind, field, call_id, customer_id, ai_value, detail)
      values (new.workspace_id, k, case when k = 'unknown_service' then 'service' else 'call_outcome' end, new.id, new.customer_id,
              case when k = 'unknown_service' then new.analysis ->> 'service' else new.outcome end,
              jsonb_strip_nulls(jsonb_build_object('confidence', new.confidence, 'summary', left(new.summary, 300))))
      on conflict (call_id, kind) where call_id is not null do nothing;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.file_call_reviews() from public, anon, authenticated;
create trigger file_call_reviews after insert or update of outcome, confidence, status, analysis on public.calls
  for each row execute function public.file_call_reviews();

create or replace function public.file_outcome_reviews()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ai record;
  avg_win numeric;
begin
  -- The latest AI call with a result for this customer.
  select id, outcome into ai from public.calls
  where customer_id = new.id and trigger <> 'test' and outcome is not null
  order by created_at desc limit 1;

  if ai.id is not null and new.status is distinct from old.status and (
       (new.status in ('showed', 'estimate', 'won') and ai.outcome in ('not_qualified', 'not_interested', 'wrong_number'))
    or (new.status = 'not_qualified' and ai.outcome in ('qualified', 'booked'))) then
    insert into public.review_items (workspace_id, kind, field, call_id, customer_id, ai_value, detail)
    values (new.workspace_id, 'disagreement', 'call_outcome', null, new.id, ai.outcome,
            jsonb_build_object('call_id', ai.id, 'result', new.status, 'reason', coalesce(new.not_qualified_reason, new.lost_reason)))
    on conflict (customer_id, kind) where call_id is null and status in ('open', 'unsure') do nothing;
  end if;

  if new.status = 'won' and new.revenue is not null and new.revenue is distinct from old.revenue then
    select avg(revenue) into avg_win from public.customers
    where workspace_id = new.workspace_id and status = 'won' and revenue is not null and id <> new.id;
    if new.revenue >= 10000 or (avg_win is not null and new.revenue >= 3 * avg_win) then
      insert into public.review_items (workspace_id, kind, field, call_id, customer_id, ai_value, detail)
      values (new.workspace_id, 'high_value', 'revenue', null, new.id, new.revenue::text,
              jsonb_strip_nulls(jsonb_build_object('average', round(avg_win, 2))))
      on conflict (customer_id, kind) where call_id is null and status in ('open', 'unsure') do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.file_outcome_reviews() from public, anon, authenticated;
create trigger file_outcome_reviews after update of status, revenue on public.customers
  for each row execute function public.file_outcome_reviews();

-- Calls already waiting for review get their items.
insert into public.review_items (workspace_id, kind, field, call_id, customer_id, ai_value, detail)
select workspace_id,
       case when status = 'error' then 'call_error' when coalesce(analysis ->> 'emergency', '') = 'true' then 'emergency'
            when outcome = 'other' then 'unclear' else 'low_confidence' end,
       'call_outcome', id, customer_id, outcome, jsonb_strip_nulls(jsonb_build_object('confidence', confidence, 'summary', left(summary, 300)))
from public.calls where needs_review and trigger <> 'test' and workspace_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Resolving
-- ---------------------------------------------------------------------------
-- p_action: approve | correct | reject | unsure. p_value (correct only): a call outcome, a service
-- value, or a revenue amount. Errors (22023): 'bad_action', 'value_required', 'bad_value', 'done'.
create or replace function public.resolve_review_item(p_item uuid, p_action text, p_value text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.review_items;
  v_call uuid;
  v_before jsonb;
  v_after jsonb;
  v_status text;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  v_value text := nullif(trim(coalesce(p_value, '')), '');
  cur record;
begin
  select * into r from public.review_items where id = p_item for update;
  if r.id is null or not (public.is_member(r.workspace_id) or auth.uid() is null) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status not in ('open', 'unsure') then raise exception 'done' using errcode = '22023'; end if;
  if p_action not in ('approve', 'correct', 'reject', 'unsure') then raise exception 'bad_action' using errcode = '22023'; end if;
  if p_action = 'correct' and v_value is null then raise exception 'value_required' using errcode = '22023'; end if;
  v_status := case p_action when 'approve' then 'approved' when 'correct' then 'corrected' when 'reject' then 'rejected' else 'unsure' end;
  v_call := coalesce(r.call_id, (r.detail ->> 'call_id')::uuid);

  if r.field = 'call_outcome' then
    select outcome, original_outcome into cur from public.calls where id = v_call;
    v_before := jsonb_build_object('outcome', cur.outcome);
    if p_action = 'correct' then
      if v_value not in ('booked', 'qualified', 'callback', 'not_interested', 'not_qualified', 'voicemail', 'no_answer', 'transferred', 'wrong_number', 'do_not_call', 'other') then
        raise exception 'bad_value' using errcode = '22023';
      end if;
      update public.calls set
        original_outcome = case when v_value is distinct from cur.outcome and cur.original_outcome is null then cur.outcome else cur.original_outcome end,
        outcome = v_value
      where id = v_call;
      v_after := jsonb_build_object('outcome', v_value);
    end if;
    if p_action <> 'unsure' and v_call is not null then
      update public.calls set needs_review = false, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = v_call;
    end if;
  elsif r.field = 'service' then
    select service into cur from public.customers where id = r.customer_id;
    v_before := jsonb_build_object('service', cur.service);
    if p_action = 'correct' then
      if v_value !~ '^[a-z0-9_]{2,40}$' then raise exception 'bad_value' using errcode = '22023'; end if;
      update public.customers set service = v_value, updated_at = now() where id = r.customer_id;
      v_after := jsonb_build_object('service', v_value);
    end if;
  elsif r.field = 'revenue' then
    select revenue into cur from public.customers where id = r.customer_id;
    v_before := jsonb_build_object('revenue', cur.revenue);
    if p_action = 'correct' then
      if v_value !~ '^\d{1,7}(\.\d{1,2})?$' or v_value::numeric <= 0 then raise exception 'bad_value' using errcode = '22023'; end if;
      perform public.set_outcome(r.customer_id, 'won', null, v_value::numeric, coalesce(v_reason, 'Corrected in review'));
      v_after := jsonb_build_object('revenue', v_value::numeric);
    end if;
  end if;

  update public.review_items set
    status = v_status, before = v_before, after = v_after, reason = v_reason,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_item;

  if r.customer_id is not null then
    insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
    values (r.workspace_id, 'review.resolved', 'review_items', p_item, r.customer_id, auth.uid(),
            jsonb_strip_nulls(jsonb_build_object('kind', r.kind, 'action', p_action, 'before', v_before, 'after', v_after, 'reason', v_reason)));
  end if;
end;
$$;
revoke execute on function public.resolve_review_item(uuid, text, text, text) from public, anon;
grant execute on function public.resolve_review_item(uuid, text, text, text) to authenticated, service_role;

-- Reviewing a call on its own page also closes its open call items.
create or replace function public.review_call(p_call uuid, p_outcome text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select id, workspace_id, customer_id, outcome, original_outcome into c from public.calls where id = p_call;
  if c.id is null or not public.is_member(c.workspace_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome is not null and p_outcome not in ('booked', 'qualified', 'callback', 'not_interested', 'not_qualified', 'voicemail',
                                                 'no_answer', 'transferred', 'wrong_number', 'do_not_call', 'other') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;

  update public.calls set
    needs_review = false,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    original_outcome = case when p_outcome is not null and p_outcome is distinct from c.outcome and c.original_outcome is null
                            then c.outcome else c.original_outcome end,
    outcome = coalesce(p_outcome, c.outcome),
    updated_at = now()
  where id = p_call;

  update public.review_items set
    status = case when p_outcome is not null and p_outcome is distinct from c.outcome then 'corrected' else 'approved' end,
    before = jsonb_build_object('outcome', c.outcome),
    after = case when p_outcome is not null and p_outcome is distinct from c.outcome then jsonb_build_object('outcome', p_outcome) end,
    reason = 'Reviewed on the call page',
    reviewed_by = auth.uid(), reviewed_at = now()
  where call_id = p_call and field = 'call_outcome' and status in ('open', 'unsure');

  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (c.workspace_id, 'call.reviewed', 'calls', p_call, c.customer_id, auth.uid(),
          jsonb_build_object('from', c.outcome, 'to', coalesce(p_outcome, c.outcome)));
end;
$$;
