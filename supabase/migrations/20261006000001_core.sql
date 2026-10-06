-- Core multi-tenant schema: users, workspaces, membership, demand profile,
-- AI agent settings, campaign plans, setup chat, event log, audit log.
-- Every tenant table carries workspace_id and is protected by RLS.

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Workspaces (one per business / tenant)
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'staff');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text not null default 'hvac',
  timezone text not null default 'America/New_York',
  phone text,
  website text,
  setup_completed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- References profiles (1:1 with auth.users) so the API can embed member profiles.
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.member_role not null default 'staff',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

-- Access helpers. SECURITY DEFINER so policies can call them without
-- recursing through workspace_members' own RLS.
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

-- True when the caller and the given user are members of a common workspace.
create function public.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ---------------------------------------------------------------------------
-- Taxonomy (vertical-agnostic reference data; HVAC seeded separately)
-- ---------------------------------------------------------------------------
create table public.taxonomy_values (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  category text not null,
  value text not null,
  label text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (vertical, category, value)
);

create table public.qualification_question_templates (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  key text not null,
  question text not null,
  answer_type text not null default 'text', -- text | boolean | number | choice
  choices text[],
  required boolean not null default true,
  sort int not null default 0,
  unique (vertical, key)
);

-- ---------------------------------------------------------------------------
-- Demand profile, AI agent settings, campaign plan, setup chat
-- ---------------------------------------------------------------------------
create table public.demand_profiles (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  services text[] not null default '{}',
  lead_types text[] not null default '{form,call}',
  customer_types text[] not null default '{}',
  zip_codes text[] not null default '{}',
  excluded_zip_codes text[] not null default '{}',
  -- {"mon": [{"start": "08:00", "end": "17:00"}], ...}
  booking_hours jsonb not null default '{}',
  capacity_per_day int,
  appointment_minutes int not null default 60,
  buffer_minutes int not null default 30,
  monthly_budget numeric(12, 2),
  target_cost_per_appointment numeric(12, 2),
  notes text,
  version int not null default 1,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.agent_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- [{"key": "...", "question": "...", "answer_type": "...", "required": true}]
  questions jsonb not null default '[]',
  transfer_phone text,
  -- {"on_request": true, "low_confidence_below": 0.6, "emergency": true}
  escalation_rules jsonb not null default '{"on_request": true, "emergency": true, "low_confidence_below": 0.6}',
  greeting text,
  version int not null default 1,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.campaign_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  summary text not null,
  plan jsonb not null,
  source text not null default 'chat', -- chat | user
  model text,
  prompt_version text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index campaign_plans_workspace_idx on public.campaign_plans (workspace_id, created_at desc);

create table public.setup_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  messages jsonb not null default '[]',
  extracted jsonb not null default '{}',
  status text not null default 'active', -- active | completed
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index setup_conversations_workspace_idx on public.setup_conversations (workspace_id);

-- ---------------------------------------------------------------------------
-- Event log (append-only) and audit log
-- ---------------------------------------------------------------------------
create table public.events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null,
  subject_table text,
  subject_id uuid,
  customer_id uuid,
  payload jsonb not null default '{}',
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index events_workspace_idx on public.events (workspace_id, created_at desc);
create index events_subject_idx on public.events (subject_table, subject_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id uuid references auth.users (id),
  action text not null,
  target text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Workspace lifecycle functions
-- ---------------------------------------------------------------------------

-- Creates a workspace, makes the caller its owner and seeds defaults
-- from the vertical's templates.
create function public.create_workspace(p_name text, p_vertical text default 'hvac')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.workspaces (name, vertical, created_by)
  values (p_name, p_vertical, auth.uid())
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, auth.uid(), 'owner');

  insert into public.demand_profiles (workspace_id, updated_by)
  values (ws, auth.uid());

  insert into public.agent_settings (workspace_id, questions, updated_by)
  select ws,
         coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'question', question, 'answer_type', answer_type,
           'choices', choices, 'required', required) order by sort), '[]'::jsonb),
         auth.uid()
  from public.qualification_question_templates
  where vertical = p_vertical;

  insert into public.events (workspace_id, type, subject_table, subject_id, actor_id)
  values (ws, 'workspace.created', 'workspaces', ws, auth.uid());

  insert into public.audit_log (workspace_id, actor_id, action, target)
  values (ws, auth.uid(), 'workspace.create', ws::text);

  return ws;
end;
$$;

create function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.workspace_invites;
begin
  select * into inv from public.workspace_invites
  where token = p_token and accepted_at is null and expires_at > now();

  if inv.id is null then
    raise exception 'invite not found or expired';
  end if;

  if lower(inv.email) <> lower((select email from public.profiles where id = auth.uid())) then
    raise exception 'invite belongs to a different email';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict do nothing;

  update public.workspace_invites set accepted_at = now() where id = inv.id;

  insert into public.audit_log (workspace_id, actor_id, action, target)
  values (inv.workspace_id, auth.uid(), 'invite.accept', inv.id::text);

  return inv.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.taxonomy_values enable row level security;
alter table public.qualification_question_templates enable row level security;
alter table public.demand_profiles enable row level security;
alter table public.agent_settings enable row level security;
alter table public.campaign_plans enable row level security;
alter table public.setup_conversations enable row level security;
alter table public.events enable row level security;
alter table public.audit_log enable row level security;

-- profiles: own row and teammates; platform admins see all. is_platform_admin is not user-editable.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_workspace(id) or public.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- workspaces
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_member(id) or public.is_platform_admin());
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- members: visible to fellow members; owners manage (but not via insert of self —
-- creation and invites go through the security-definer functions).
create policy members_select on public.workspace_members for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy members_update on public.workspace_members for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy members_delete on public.workspace_members for delete to authenticated
  using (public.is_owner(workspace_id) and user_id <> auth.uid());

-- invites: owners only
create policy invites_select on public.workspace_invites for select to authenticated
  using (public.is_owner(workspace_id));
create policy invites_insert on public.workspace_invites for insert to authenticated
  with check (public.is_owner(workspace_id));
create policy invites_delete on public.workspace_invites for delete to authenticated
  using (public.is_owner(workspace_id));

-- reference data: read-only for signed-in users
create policy taxonomy_select on public.taxonomy_values for select to authenticated using (true);
create policy question_templates_select on public.qualification_question_templates
  for select to authenticated using (true);

-- demand profile / agent settings: members read, owners write
create policy demand_profiles_select on public.demand_profiles for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy demand_profiles_update on public.demand_profiles for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy agent_settings_select on public.agent_settings for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy agent_settings_update on public.agent_settings for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

-- campaign plans: members read, owners create (history kept, no update/delete)
create policy campaign_plans_select on public.campaign_plans for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy campaign_plans_insert on public.campaign_plans for insert to authenticated
  with check (public.is_owner(workspace_id));

-- setup chat: owners only
create policy setup_conversations_select on public.setup_conversations for select to authenticated
  using (public.is_owner(workspace_id));
create policy setup_conversations_insert on public.setup_conversations for insert to authenticated
  with check (public.is_owner(workspace_id));
create policy setup_conversations_update on public.setup_conversations for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

-- events: append-only. Members read and append as themselves; nobody updates/deletes.
create policy events_select on public.events for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy events_insert on public.events for insert to authenticated
  with check (public.is_member(workspace_id) and actor_id = auth.uid());

-- audit log: owners see their workspace, platform admins see all; written by
-- security-definer functions and server code only.
create policy audit_log_select on public.audit_log for select to authenticated
  using ((workspace_id is not null and public.is_owner(workspace_id)) or public.is_platform_admin());
