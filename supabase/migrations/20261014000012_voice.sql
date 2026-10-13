-- M3: AI voice through Retell (agency model: Lead96 owns the Retell account).
--
-- voice_agents         = the Retell agent of one business, generated from its setup (demand profile,
--                        agent settings, questions). One row per business.
-- voice_agent_versions = every config we pushed to Retell, so a call can be traced to the exact
--                        prompt and questions it used.
-- phone_numbers        = numbers in the Lead96 Retell account, assigned to one business. Inbound calls
--                        to a number belong to that business; outbound calls use it as caller ID.
-- calls                = every AI call (inbound and outbound): status, outcome, summary, answers,
--                        transcript and the stored recording.
-- customers.do_not_call = the person asked not to be called again (never called by the AI after).
--
-- All of these are written only by server code with the service role; members read.

create table public.voice_agents (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  retell_agent_id text unique,
  retell_llm_id text unique,
  version int not null default 0,
  config_hash text,
  synced_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  -- Owner switch for automatic calls to new leads (off until the owner turns it on).
  auto_call boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.voice_agent_versions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version int not null,
  config jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, version)
);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  e164 text not null unique check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider text not null default 'retell' check (provider in ('retell', 'twilio')),
  nickname text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index phone_numbers_workspace_idx on public.phone_numbers (workspace_id);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  provider_call_id text unique,                  -- Retell call_id
  direction text not null check (direction in ('inbound', 'outbound')),
  trigger text not null check (trigger in ('fast_callback', 'retry', 'manual', 'test', 'inbound')),
  attempt int not null default 1,
  from_number text,
  to_number text,
  status text not null default 'queued'
    check (status in ('queued', 'registered', 'ongoing', 'ended', 'not_connected', 'error')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  disconnection_reason text,
  outcome text check (outcome in ('booked', 'qualified', 'callback', 'not_interested', 'not_qualified', 'voicemail',
                                  'no_answer', 'transferred', 'wrong_number', 'do_not_call', 'other')),
  summary text,
  sentiment text,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  needs_review boolean not null default false,
  analysis jsonb not null default '{}',          -- answers and labels extracted after the call
  transcript jsonb,                              -- [{role: "agent" | "user", content}]
  recording_path text,                           -- object in the call-recordings bucket
  transferred boolean not null default false,
  cost_usd numeric(10, 4),
  agent_version int,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_workspace_idx on public.calls (workspace_id, created_at desc);
create index calls_customer_idx on public.calls (customer_id, created_at desc);
create index calls_review_idx on public.calls (workspace_id, created_at desc) where needs_review;

alter table public.customers
  add column do_not_call boolean not null default false,
  add column do_not_call_at timestamptz;

-- Retell webhooks are logged like the other providers.
alter table public.webhook_deliveries drop constraint webhook_deliveries_provider_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_provider_check
  check (provider in ('call', 'meta', 'google', 'retell'));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.voice_agents enable row level security;
alter table public.voice_agent_versions enable row level security;
alter table public.phone_numbers enable row level security;
alter table public.calls enable row level security;

create policy voice_agents_select on public.voice_agents for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy voice_agent_versions_select on public.voice_agent_versions for select to authenticated
  using (public.is_owner(workspace_id) or public.is_platform_admin());
create policy phone_numbers_select on public.phone_numbers for select to authenticated
  using ((workspace_id is not null and public.is_member(workspace_id)) or public.is_platform_admin());
create policy calls_select on public.calls for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

-- Owners switch automatic calling on/off; everything else on voice_agents is server-managed.
create or replace function public.set_auto_call(p_workspace uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner(p_workspace) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.voice_agents set auto_call = p_on, updated_at = now() where workspace_id = p_workspace;
  if not found then
    raise exception 'The AI caller is not set up for this business yet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (workspace_id, actor_id, action, target, metadata)
  values (p_workspace, auth.uid(), 'voice.auto_call', 'voice_agents', jsonb_build_object('on', p_on));
end;
$$;
revoke execute on function public.set_auto_call(uuid, boolean) from public, anon;
grant execute on function public.set_auto_call(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Call recordings: private bucket, one folder per business; members listen through signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-recordings', 'call-recordings', false, 52428800, array['audio/wav', 'audio/mpeg', 'audio/x-wav'])
on conflict (id) do nothing;

create policy call_recordings_select on storage.objects for select to authenticated
  using (bucket_id = 'call-recordings'
         and (public.is_member(((storage.foldername(name))[1])::uuid) or public.is_platform_admin()));
