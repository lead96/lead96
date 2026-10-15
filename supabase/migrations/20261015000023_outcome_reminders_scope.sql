-- plan_outcome_reminders() can be limited to one business (tests and manual runs), so planning for
-- one business never queues reminder emails for the others. The daily cron job still calls it
-- without an argument (all businesses).

drop function public.plan_outcome_reminders();

create or replace function public.plan_outcome_reminders(p_workspace uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  w record;
begin
  for w in
    select ws.id from public.workspaces ws
    where (p_workspace is null or ws.id = p_workspace)
      and exists (select 1 from public.appointments a where a.workspace_id = ws.id and a.ends_at < now() - interval '1 hour'
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
revoke execute on function public.plan_outcome_reminders(uuid) from public, anon, authenticated;
grant execute on function public.plan_outcome_reminders(uuid) to service_role;
