-- M6 security review: tighten table privileges (defence in depth on top of row-level security).
--
-- Supabase grants every table to anon and authenticated by default. RLS already blocks anon (there
-- are no anon policies) and limits authenticated, but:
--   * TRUNCATE is not covered by row-level security, so nobody but the server should hold it;
--   * anon (signed-out visitors) never writes directly: public forms, invites and sign-ups go
--     through the server (service role) or security definer functions;
--   * REFERENCES / TRIGGER are never needed by API users.
-- Default privileges make tables created by later migrations follow the same rule.

do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
  end loop;
end;
$$;

alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
