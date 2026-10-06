-- Deleting a user was blocked by "who did it" references (audit log, events,
-- created_by/updated_by). Keep those rows as history and clear the user link instead.

alter table public.workspaces
  drop constraint workspaces_created_by_fkey,
  add constraint workspaces_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table public.workspace_invites
  drop constraint workspace_invites_invited_by_fkey,
  add constraint workspace_invites_invited_by_fkey
    foreign key (invited_by) references auth.users (id) on delete set null;

alter table public.demand_profiles
  drop constraint demand_profiles_updated_by_fkey,
  add constraint demand_profiles_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.agent_settings
  drop constraint agent_settings_updated_by_fkey,
  add constraint agent_settings_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.campaign_plans
  drop constraint campaign_plans_created_by_fkey,
  add constraint campaign_plans_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table public.setup_conversations
  drop constraint setup_conversations_created_by_fkey,
  add constraint setup_conversations_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table public.events
  drop constraint events_actor_id_fkey,
  add constraint events_actor_id_fkey
    foreign key (actor_id) references auth.users (id) on delete set null;

alter table public.audit_log
  drop constraint audit_log_actor_id_fkey,
  add constraint audit_log_actor_id_fkey
    foreign key (actor_id) references auth.users (id) on delete set null;
