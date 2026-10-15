-- M5 part 1: outcomes.
--
-- customers gain the job result: "not qualified" (new status, with a reason), the estimate amount,
-- the revenue of a won job and the reason a job was lost. All of it is set through set_outcome(),
-- which checks the rules (won needs revenue, lost and not qualified need a reason) and writes a
-- customer.status_changed event with who, when and why. The change history (migration 018) keeps
-- the old and new values as well.
--
-- Pending outcomes = booked visits whose date has passed without a result (still booked or
-- confirmed), and visits that happened whose job has no final result yet (won, lost or not
-- qualified). pending_outcome_counts() counts them; on weekday mornings plan_outcome_reminders()
-- queues one reminder email per business that has any (sent by the per-minute runner).

-- ---------------------------------------------------------------------------
-- Outcome fields
-- ---------------------------------------------------------------------------
alter table public.customers drop constraint customers_status_check;
alter table public.customers add constraint customers_status_check
  check (status in ('new', 'contacted', 'qualified', 'not_qualified', 'appointment', 'showed', 'estimate', 'won', 'lost'));

alter table public.customers
  add column not_qualified_reason text check (not_qualified_reason in ('outside_area', 'service_not_offered', 'spam_or_wrong_number', 'no_real_need', 'price_shopping', 'duplicate', 'other')),
  add column lost_reason text check (lost_reason in ('price', 'competitor', 'no_response', 'not_ready', 'financing', 'changed_mind', 'other')),
  add column estimate_amount numeric(12, 2) check (estimate_amount >= 0 and estimate_amount < 10000000),
  add column revenue numeric(12, 2) check (revenue >= 0 and revenue < 10000000),
  add column closed_at timestamptz,
  add column outcome_updated_at timestamptz;
create index customers_closed_idx on public.customers (workspace_id, closed_at) where status in ('won', 'lost');

-- The plain status switch now knows "not qualified" too (reasons are set through set_outcome).
create or replace function public.set_customer_status(p_customer uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not public.is_member(c.workspace_id) then raise exception 'not_found'; end if;
  if p_status not in ('new', 'contacted', 'qualified', 'not_qualified', 'appointment', 'showed', 'estimate', 'won', 'lost') then
    raise exception 'invalid_status';
  end if;
  if c.status = p_status then return; end if;
  update public.customers set status = p_status, updated_at = now() where id = p_customer;
  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (c.workspace_id, 'customer.status_changed', 'customers', p_customer, p_customer, auth.uid(),
          jsonb_strip_nulls(jsonb_build_object('from', c.status, 'to', p_status, 'reason', nullif(trim(p_reason), ''))));
end;
$$;

-- Records the result for a customer. p_amount: estimate amount (estimate) or revenue (won).
-- p_reason: reason code (not_qualified, lost). p_note: why, in the user's words (shown on the timeline).
-- Errors (22023): 'invalid_status', 'reason_required', 'amount_required'. Returns false if nothing changed.
create or replace function public.set_outcome(p_customer uuid, p_status text, p_reason text, p_amount numeric, p_note text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_final boolean := p_status in ('won', 'lost', 'not_qualified');
begin
  select * into c from public.customers where id = p_customer for update;
  if c.id is null or not (public.is_member(c.workspace_id) or auth.uid() is null) then raise exception 'not_found'; end if;
  if p_status not in ('new', 'contacted', 'qualified', 'not_qualified', 'appointment', 'showed', 'estimate', 'won', 'lost') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'not_qualified' and (v_reason is null or v_reason not in ('outside_area', 'service_not_offered', 'spam_or_wrong_number', 'no_real_need', 'price_shopping', 'duplicate', 'other')) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_status = 'lost' and (v_reason is null or v_reason not in ('price', 'competitor', 'no_response', 'not_ready', 'financing', 'changed_mind', 'other')) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_status in ('won', 'estimate') and (p_amount is null or p_amount <= 0) then
    raise exception 'amount_required' using errcode = '22023';
  end if;
  if p_status not in ('won', 'estimate', 'lost', 'not_qualified') then v_reason := null; end if;

  if c.status = p_status
     and coalesce(v_reason, '') = coalesce(case p_status when 'lost' then c.lost_reason when 'not_qualified' then c.not_qualified_reason end, '')
     and (p_status not in ('won', 'estimate') or p_amount = case p_status when 'won' then c.revenue else c.estimate_amount end)
     and v_note is null then
    return false;
  end if;

  update public.customers set
    status = p_status,
    not_qualified_reason = case when p_status = 'not_qualified' then v_reason end,
    lost_reason = case when p_status = 'lost' then v_reason end,
    estimate_amount = case when p_status = 'estimate' then round(p_amount, 2) else estimate_amount end,
    revenue = case when p_status = 'won' then round(p_amount, 2) end,
    -- Keeps the first close date when only the amount or reason is corrected.
    closed_at = case when not v_final then null when c.status = p_status then coalesce(c.closed_at, now()) else now() end,
    outcome_updated_at = now(),
    updated_at = now()
  where id = p_customer;

  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (c.workspace_id, 'customer.status_changed', 'customers', p_customer, p_customer, auth.uid(),
          jsonb_strip_nulls(jsonb_build_object(
            'from', c.status, 'to', p_status, 'reason', v_note, 'reason_code', v_reason,
            'amount', case when p_status in ('won', 'estimate') then round(p_amount, 2) end)));
  return true;
end;
$$;
revoke execute on function public.set_outcome(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.set_outcome(uuid, text, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pending outcomes
-- ---------------------------------------------------------------------------
-- visits = booked/confirmed visits that ended more than an hour ago.
-- jobs   = visits marked done whose customer has no final result (won, lost, not qualified).
create or replace function public.pending_outcome_counts(p_workspace uuid)
returns table (visits int, jobs int, oldest timestamptz)
language sql stable security definer set search_path = public as $$
  with guard as (
    select 1 where auth.uid() is null or public.is_member(p_workspace) or public.is_platform_admin()
  ), v as (
    select a.ends_at from public.appointments a, guard
    where a.workspace_id = p_workspace and a.status in ('scheduled', 'confirmed') and a.ends_at < now() - interval '1 hour'
  ), j as (
    select distinct on (a.customer_id) a.ends_at from public.appointments a
    join public.customers c on c.id = a.customer_id, guard
    where a.workspace_id = p_workspace and a.status = 'completed' and c.status not in ('won', 'lost', 'not_qualified')
    order by a.customer_id, a.ends_at desc
  )
  select (select count(*)::int from v), (select count(*)::int from j),
         (select min(x) from (select ends_at x from v union all select ends_at from j) t);
$$;
revoke execute on function public.pending_outcome_counts(uuid) from public, anon;
grant execute on function public.pending_outcome_counts(uuid) to authenticated, service_role;

-- Reminder emails reuse the visit message queue: no visit, kind 'pending_outcomes'.
alter table public.notification_jobs alter column appointment_id drop not null;
alter table public.notification_jobs drop constraint notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check (kind in ('confirmation', 'reminder_24h', 'reminder_2h', 'rescheduled', 'cancelled', 'team_new_booking', 'pending_outcomes'));
alter table public.notification_jobs add constraint notification_jobs_visit_check
  check ((kind = 'pending_outcomes') = (appointment_id is null));

-- One reminder per business per day at most, only when something is pending.
create or replace function public.plan_outcome_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  w record;
begin
  for w in
    select ws.id from public.workspaces ws
    where exists (select 1 from public.appointments a where a.workspace_id = ws.id and a.ends_at < now() - interval '1 hour'
                  and a.status in ('scheduled', 'confirmed', 'completed'))
      and not exists (select 1 from public.notification_jobs nj where nj.workspace_id = ws.id and nj.kind = 'pending_outcomes'
                      and nj.created_at > now() - interval '20 hours')
  loop
    if (select visits + jobs from public.pending_outcome_counts(w.id)) > 0 then
      insert into public.notification_jobs (workspace_id, kind, run_at) values (w.id, 'pending_outcomes', now());
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.plan_outcome_reminders() from public, anon, authenticated;
grant execute on function public.plan_outcome_reminders() to service_role;

-- Weekdays 14:00 UTC (10am Eastern, 7am Pacific); the per-minute tick then sends them.
select cron.schedule('lead96-outcome-reminders', '0 14 * * 1-5', 'select public.plan_outcome_reminders()');
