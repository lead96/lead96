-- M2: Leads + Customers (CRM) + Landing pages.
--
-- customers  = one row per real person per workspace (deduplicated by phone / email).
-- leads      = every form submission or call, linked to a customer, with full source data.
--              Lead and Call are both first-class (kind), per agreement §5.
-- landing_pages = template-based pages published at /p/{slug}; their forms create leads.
-- All intake goes through ingest_lead() (service role only), which matches/creates the
-- customer under a per-workspace lock, so concurrent leads from one person never duplicate.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  full_name text,
  phone text,                -- E.164 (+12145550100)
  email text,                -- lower-case
  zip text,
  address text,
  service text,              -- latest service interest (taxonomy value)
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'appointment', 'showed', 'estimate', 'won', 'lost')),
  first_source text,
  first_lead_at timestamptz,
  last_lead_at timestamptz,
  lead_count int not null default 0,
  merged_into uuid references public.customers (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_workspace_idx on public.customers (workspace_id, last_lead_at desc nulls last);
-- One live customer per phone / email per workspace (merged rows are excluded).
create unique index customers_phone_uidx on public.customers (workspace_id, phone)
  where phone is not null and merged_into is null;
create unique index customers_email_uidx on public.customers (workspace_id, email)
  where email is not null and merged_into is null;

-- ---------------------------------------------------------------------------
-- Landing pages
-- ---------------------------------------------------------------------------
create table public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  template text not null check (template in ('call_first', 'quote_form_call', 'multi_step_quiz', 'seasonal_offer')),
  content jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index landing_pages_workspace_idx on public.landing_pages (workspace_id);

-- ---------------------------------------------------------------------------
-- Leads (form submissions and calls)
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind in ('form', 'call')),
  source text not null check (source in ('landing_page', 'meta', 'google', 'csv', 'manual', 'call', 'website')),
  external_id text,          -- Meta lead id, Google lead id, call id… (idempotency)
  landing_page_id uuid references public.landing_pages (id) on delete set null,
  campaign_id text, campaign_name text,
  adset_id text, adset_name text,      -- Meta ad set / Google ad group
  ad_id text, ad_name text,
  keyword text,
  form_id text, form_name text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid text, fbclid text,
  page_url text, referrer text,
  full_name text, phone text, email text, zip text,
  service text, message text,
  fields jsonb not null default '{}',  -- every raw answer, as submitted
  consent_given boolean not null default false,
  consent jsonb,                       -- {text, version, at, ip, user_agent}
  attribution_complete boolean not null default false,
  cost numeric(12, 2),                 -- allocated from ad spend (M5)
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, source, external_id)
);
create index leads_workspace_idx on public.leads (workspace_id, received_at desc);
create index leads_customer_idx on public.leads (customer_id, received_at desc);

-- events.customer_id existed from M1 without a foreign key; add it now that customers exist.
alter table public.events
  add constraint events_customer_id_fkey foreign key (customer_id) references public.customers (id) on delete set null;
create index events_customer_idx on public.events (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.landing_pages enable row level security;

-- customers: members read; changes go through set_customer_status() / update_customer() (logged).
create policy customers_select on public.customers for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

-- leads: members read; written only by ingest_lead() (service role).
create policy leads_select on public.leads for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());

-- landing pages: members read; owners create/edit/delete.
create policy landing_pages_select on public.landing_pages for select to authenticated
  using (public.is_member(workspace_id) or public.is_platform_admin());
create policy landing_pages_insert on public.landing_pages for insert to authenticated
  with check (public.is_owner(workspace_id));
create policy landing_pages_update on public.landing_pages for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy landing_pages_delete on public.landing_pages for delete to authenticated
  using (public.is_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- ingest_lead: the one way leads enter the system
-- ---------------------------------------------------------------------------
-- p = normalized lead (phone E.164, email lower-case) — see src/lib/leads/ingest.ts.
-- Returns {lead_id, customer_id, customer_created, duplicate}.
create function public.ingest_lead(p jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := (p ->> 'workspace_id')::uuid;
  v_phone text := nullif(p ->> 'phone', '');
  v_email text := nullif(lower(p ->> 'email'), '');
  v_received timestamptz := coalesce((p ->> 'received_at')::timestamptz, now());
  by_phone uuid;
  by_email uuid;
  cust uuid;
  created boolean := false;
  existing uuid;
  new_lead uuid;
begin
  if ws is null then raise exception 'workspace_id required'; end if;

  -- Same external lead delivered twice (webhook retry): return the original.
  if nullif(p ->> 'external_id', '') is not null then
    select id, customer_id into existing, cust from public.leads
    where workspace_id = ws and source = p ->> 'source' and external_id = p ->> 'external_id';
    if existing is not null then
      return jsonb_build_object('lead_id', existing, 'customer_id', cust, 'customer_created', false, 'duplicate', true);
    end if;
  end if;

  -- Serialize identity matching per workspace so concurrent leads can't create twin customers.
  perform pg_advisory_xact_lock(hashtextextended(ws::text, 0));

  if v_phone is not null then
    select id into by_phone from public.customers where workspace_id = ws and phone = v_phone and merged_into is null;
  end if;
  if v_email is not null then
    select id into by_email from public.customers where workspace_id = ws and email = v_email and merged_into is null;
  end if;
  cust := coalesce(by_phone, by_email);

  if cust is null then
    insert into public.customers (workspace_id, full_name, phone, email, zip, service, first_source, first_lead_at)
    values (ws, nullif(p ->> 'full_name', ''), v_phone, v_email, nullif(p ->> 'zip', ''), nullif(p ->> 'service', ''),
            p ->> 'source', v_received)
    returning id into cust;
    created := true;
    insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, payload)
    values (ws, 'customer.created', 'customers', cust, cust, jsonb_build_object('source', p ->> 'source'));
  else
    -- Fill blanks only; never overwrite what we already know. Don't take an email/phone that
    -- belongs to another live customer (that's a possible duplicate, logged below).
    update public.customers c set
      full_name = coalesce(c.full_name, nullif(p ->> 'full_name', '')),
      phone = coalesce(c.phone, case when by_email is not null and by_phone is null then v_phone end),
      email = coalesce(c.email, case when by_phone is not null and by_email is null then v_email end),
      zip = coalesce(c.zip, nullif(p ->> 'zip', '')),
      service = coalesce(nullif(p ->> 'service', ''), c.service),
      updated_at = now()
    where c.id = cust;
    if by_phone is not null and by_email is not null and by_phone <> by_email then
      insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, payload)
      values (ws, 'customer.possible_duplicate', 'customers', by_phone, by_phone,
              jsonb_build_object('other_customer_id', by_email, 'reason', 'phone and email match different customers'));
    end if;
  end if;

  insert into public.leads (
    workspace_id, customer_id, kind, source, external_id, landing_page_id,
    campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, keyword, form_id, form_name,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, page_url, referrer,
    full_name, phone, email, zip, service, message, fields, consent_given, consent, attribution_complete, received_at
  ) values (
    ws, cust, p ->> 'kind', p ->> 'source', nullif(p ->> 'external_id', ''), nullif(p ->> 'landing_page_id', '')::uuid,
    p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name', p ->> 'ad_id', p ->> 'ad_name',
    p ->> 'keyword', p ->> 'form_id', p ->> 'form_name',
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_content', p ->> 'utm_term',
    p ->> 'gclid', p ->> 'fbclid', p ->> 'page_url', p ->> 'referrer',
    nullif(p ->> 'full_name', ''), v_phone, v_email, nullif(p ->> 'zip', ''), nullif(p ->> 'service', ''), p ->> 'message',
    coalesce(p -> 'fields', '{}'::jsonb), coalesce((p ->> 'consent_given')::boolean, false), p -> 'consent',
    coalesce((p ->> 'attribution_complete')::boolean, false), v_received
  ) returning id into new_lead;

  update public.customers set
    lead_count = lead_count + 1,
    last_lead_at = greatest(coalesce(last_lead_at, v_received), v_received),
    first_lead_at = least(coalesce(first_lead_at, v_received), v_received)
  where id = cust;

  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, payload)
  values (ws, 'lead.received', 'leads', new_lead, cust, jsonb_strip_nulls(jsonb_build_object(
    'source', p ->> 'source', 'kind', p ->> 'kind', 'service', p ->> 'service',
    'campaign', coalesce(p ->> 'campaign_name', p ->> 'utm_campaign'), 'landing_page_id', p ->> 'landing_page_id')));

  return jsonb_build_object('lead_id', new_lead, 'customer_id', cust, 'customer_created', created, 'duplicate', false);
end;
$$;

revoke execute on function public.ingest_lead(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_lead(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- CRM changes by members (logged as events; history is never overwritten)
-- ---------------------------------------------------------------------------
create function public.set_customer_status(p_customer uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not public.is_member(c.workspace_id) then raise exception 'not_found'; end if;
  if p_status not in ('new', 'contacted', 'qualified', 'appointment', 'showed', 'estimate', 'won', 'lost') then
    raise exception 'invalid_status';
  end if;
  if c.status = p_status then return; end if;
  update public.customers set status = p_status, updated_at = now() where id = p_customer;
  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (c.workspace_id, 'customer.status_changed', 'customers', p_customer, p_customer, auth.uid(),
          jsonb_strip_nulls(jsonb_build_object('from', c.status, 'to', p_status, 'reason', nullif(trim(p_reason), ''))));
end;
$$;

create function public.update_customer_notes(p_customer uuid, p_notes text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.customers where id = p_customer;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  update public.customers set notes = left(p_notes, 5000), updated_at = now() where id = p_customer;
  insert into public.events (workspace_id, type, subject_table, subject_id, customer_id, actor_id, payload)
  values (ws, 'customer.notes_updated', 'customers', p_customer, p_customer, auth.uid(), '{}');
end;
$$;

revoke execute on function public.set_customer_status(uuid, text, text) from public, anon;
grant execute on function public.set_customer_status(uuid, text, text) to authenticated;
revoke execute on function public.update_customer_notes(uuid, text) from public, anon;
grant execute on function public.update_customer_notes(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Landing page images (logos): public read, owners write into their workspace folder
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('landing-assets', 'landing-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy landing_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'landing-assets' and public.is_owner(((storage.foldername(name))[1])::uuid));
create policy landing_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'landing-assets' and public.is_owner(((storage.foldername(name))[1])::uuid));
create policy landing_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'landing-assets' and public.is_owner(((storage.foldername(name))[1])::uuid));
