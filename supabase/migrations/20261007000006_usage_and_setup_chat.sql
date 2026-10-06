-- Usage records: AI tokens now; voice minutes and SMS later. Basis for credits/billing (Phase 2).
-- Written only by trusted server code with the service role; owners and platform admins can read.
create table public.usage_records (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,      -- ai_tokens | voice_minutes | sms
  feature text not null,   -- setup_chat | campaign_plan | ...
  quantity numeric not null,
  model text,
  metadata jsonb not null default '{}',
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index usage_records_workspace_idx on public.usage_records (workspace_id, created_at);

alter table public.usage_records enable row level security;
create policy usage_records_select on public.usage_records for select to authenticated
  using (public.is_owner(workspace_id) or public.is_platform_admin());

-- Per-conversation counters so one chat cannot run up unbounded AI cost.
alter table public.setup_conversations
  add column total_tokens int not null default 0,
  add column user_turns int not null default 0;
