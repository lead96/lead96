-- Change history (Husam 2026-10-14: "who did, when, track every single change").
--
-- Every insert / update / delete on the important tables is written to change_log by a trigger:
-- who (auth.uid() of the signed-in user, or "system" for webhooks, jobs and admin scripts), when,
-- which row, and the old and new values (for updates: only the columns that changed).
-- Secrets (invite tokens, webhook keys) and large text already stored elsewhere (call/text
-- transcripts) are left out. Append-only: rows cannot be updated or deleted.
-- workspace_id has no foreign key on purpose: deleting a business keeps the record of what was deleted.

create table public.change_log (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  via text not null check (via in ('user', 'system')),
  changed_fields text[],
  old_values jsonb,
  new_values jsonb,
  at timestamptz not null default now()
);
create index change_log_workspace_idx on public.change_log (workspace_id, at desc);
create index change_log_row_idx on public.change_log (table_name, row_id, at desc);
create index change_log_at_idx on public.change_log (at desc);

alter table public.change_log enable row level security;
create policy change_log_select on public.change_log for select to authenticated
  using ((workspace_id is not null and public.is_owner(workspace_id)) or public.is_platform_admin());
revoke insert, update, delete, truncate on public.change_log from authenticated, anon;

create or replace function public.change_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'change_log is append-only' using errcode = '42501';
end;
$$;
create trigger change_log_no_update before update or delete on public.change_log
  for each row execute function public.change_log_append_only();

-- TG_ARGV: [0] workspace column ('' = none), [1] row id column, [2..] columns never logged.
create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  full_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  full_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rec jsonb := coalesce(full_new, full_old);
  o jsonb := full_old;
  n jsonb := full_new;
  changed text[];
  skip text;
  i int;
begin
  -- Never log the skipped columns or the bookkeeping timestamp.
  for i in 2 .. coalesce(tg_nargs, 0) - 1 loop
    skip := tg_argv[i];
    o := o - skip;
    n := n - skip;
  end loop;
  o := o - 'updated_at';
  n := n - 'updated_at';

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into changed
    from jsonb_object_keys(n) k
    where (n -> k) is distinct from (o -> k);
    if changed is null then
      return new;
    end if;
    o := (select jsonb_object_agg(k, o -> k) from unnest(changed) k);
    n := (select jsonb_object_agg(k, n -> k) from unnest(changed) k);
  end if;

  insert into public.change_log (workspace_id, table_name, row_id, action, actor_id, via, changed_fields, old_values, new_values)
  values (
    case when tg_argv[0] <> '' then (rec ->> tg_argv[0])::uuid end,
    tg_table_name,
    coalesce(rec ->> tg_argv[1], '?'),
    lower(tg_op),
    auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    changed,
    case when tg_op <> 'INSERT' then o end,
    case when tg_op <> 'DELETE' then n end
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function public.log_change() from public, anon, authenticated;

create trigger log_change after insert or update or delete on public.workspaces
  for each row execute function public.log_change('id', 'id');
create trigger log_change after insert or update or delete on public.workspace_members
  for each row execute function public.log_change('workspace_id', 'user_id');
create trigger log_change after insert or update or delete on public.workspace_invites
  for each row execute function public.log_change('workspace_id', 'id', 'token');
create trigger log_change after insert or update or delete on public.customers
  for each row execute function public.log_change('workspace_id', 'id');
create trigger log_change after insert or update or delete on public.leads
  for each row execute function public.log_change('workspace_id', 'id');
create trigger log_change after insert or update or delete on public.calls
  for each row execute function public.log_change('workspace_id', 'id', 'transcript');
create trigger log_change after insert or update or delete on public.messages
  for each row execute function public.log_change('workspace_id', 'id', 'transcript');
create trigger log_change after insert or update or delete on public.landing_pages
  for each row execute function public.log_change('workspace_id', 'id');
create trigger log_change after insert or update or delete on public.demand_profiles
  for each row execute function public.log_change('workspace_id', 'workspace_id');
create trigger log_change after insert or update or delete on public.agent_settings
  for each row execute function public.log_change('workspace_id', 'workspace_id');
create trigger log_change after insert or update or delete on public.voice_agents
  for each row execute function public.log_change('workspace_id', 'workspace_id');
create trigger log_change after insert or update or delete on public.phone_numbers
  for each row execute function public.log_change('workspace_id', 'id');
create trigger log_change after insert or update or delete on public.ad_accounts
  for each row execute function public.log_change('workspace_id', 'id', 'webhook_key');
-- Platform admin rights and names (no business).
create trigger log_change after insert or update or delete on public.profiles
  for each row execute function public.log_change('', 'id');
