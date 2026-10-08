-- M2: Google Ads (agency model: one Lead96 manager account, one admin sign-in).
--
-- platform_connections = Lead96's own sign-ins to ad platforms (Google Ads now, Meta later).
--                        The refresh token is stored AES-256-GCM encrypted (key in server env);
--                        no client role can read this table at all.
-- ad_accounts          = an ad account under the manager account, assigned to one business.
--                        Leads and spend from that account belong to that business.
--                        webhook_key = secret for that account's lead-form webhook (server only).
-- ad_spend_daily       = cost / clicks / impressions per campaign per day (attribution in M5).

create table public.platform_connections (
  provider text primary key check (provider in ('google_ads', 'meta')),
  account_email text,
  secret_ciphertext text not null,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz
);
alter table public.platform_connections enable row level security;
-- No policies: service role only.

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null check (platform in ('google', 'meta')),
  external_id text not null,          -- Google customer ID (digits only) / Meta act_ id
  name text,
  currency text,
  time_zone text,
  webhook_key text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok', 'error')),
  last_sync_error text,
  last_sync_summary jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index ad_accounts_workspace_idx on public.ad_accounts (workspace_id);

alter table public.ad_accounts enable row level security;
create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
-- The webhook key never reaches the browser: members may read every column except it.
revoke select on public.ad_accounts from authenticated, anon;
grant select (id, workspace_id, platform, external_id, name, currency, time_zone, last_sync_at, last_sync_status,
              last_sync_error, last_sync_summary, created_by, created_at)
  on public.ad_accounts to authenticated;

create table public.ad_spend_daily (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null check (platform in ('google', 'meta')),
  account_external_id text not null,
  campaign_id text not null,
  campaign_name text,
  date date not null,
  cost numeric(12, 2) not null default 0,
  currency text,
  clicks int not null default 0,
  impressions int not null default 0,
  conversions numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (platform, account_external_id, campaign_id, date)
);
create index ad_spend_daily_workspace_idx on public.ad_spend_daily (workspace_id, date desc);

alter table public.ad_spend_daily enable row level security;
create policy ad_spend_daily_select on public.ad_spend_daily for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

-- Test leads sent from the Google Ads form editor are logged, not added to the CRM.
alter table public.webhook_deliveries drop constraint webhook_deliveries_status_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_status_check
  check (status in ('processed', 'duplicate', 'rejected', 'failed', 'test'));
