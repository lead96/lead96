-- M3: call review. Members (owners and staff) mark AI calls as reviewed and may correct the outcome.
-- The AI's own outcome is kept in original_outcome when someone changes it (training data / QA).

alter table public.calls
  add column reviewed_by uuid references auth.users (id) on delete set null,
  add column reviewed_at timestamptz,
  add column original_outcome text;

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

  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (c.workspace_id, 'call.reviewed', 'calls', p_call, c.customer_id, auth.uid(),
          jsonb_build_object('from', c.outcome, 'to', coalesce(p_outcome, c.outcome)));
end;
$$;
revoke execute on function public.review_call(uuid, text) from public, anon;
grant execute on function public.review_call(uuid, text) to authenticated;
