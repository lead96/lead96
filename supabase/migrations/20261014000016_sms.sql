-- M3: texts through Retell (no Twilio). After an automatic AI call is not answered, the lead gets one
-- text; replies are answered by the business's text agent (a Retell chat agent on the same number).
--
-- voice_agents.retell_chat_agent_id / retell_sms_llm_id = the business's text agent.
-- messages = every text conversation we started (one row per Retell SMS chat): who, why, status, the
--            first text and the conversation. Written by the server only; members read.

alter table public.voice_agents
  add column retell_chat_agent_id text unique,
  add column retell_sms_llm_id text unique;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  call_id uuid references public.calls (id) on delete set null,
  channel text not null default 'sms' check (channel in ('sms')),
  reason text not null check (reason in ('no_answer', 'manual', 'inbound')),
  provider_chat_id text unique,
  from_number text,
  to_number text,
  body text,                                    -- the first text we sent
  status text not null default 'queued' check (status in ('queued', 'sent', 'ongoing', 'ended', 'failed', 'skipped')),
  error text,
  transcript jsonb,                             -- [{role: "agent" | "user", content}]
  summary text,
  replied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_workspace_idx on public.messages (workspace_id, created_at desc);
create index messages_customer_idx on public.messages (customer_id, created_at desc);

alter table public.messages enable row level security;
create policy messages_select on public.messages for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
