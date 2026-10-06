@AGENTS.md

## Project notes

- Read `README.md` for stack, scripts and layout.
- Next.js 16: `proxy.ts` replaces `middleware.ts`; `cookies()`, `params`, `searchParams` are async. Use `--webpack` (Turbopack segfaults on this machine).
- All tenant data is protected by Supabase RLS. New tenant tables need `workspace_id`, RLS enabled and policies using `is_member` / `is_owner` / `is_platform_admin`, plus a case in `tests/rls.test.ts`.
- Schema changes go in a new file under `supabase/migrations/`; never edit an applied migration.
- Product scope, plan and decisions live in the git-ignored `docs/` folder; keep it updated as work progresses.
