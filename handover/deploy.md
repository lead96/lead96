# Deploy

## Code

1. Work on a branch or on `main`; run `npm run typecheck`, `npm run lint` and `npm test` locally (on Windows run tests from PowerShell).
2. Push to GitHub. **CI** (`.github/workflows/ci.yml`) runs type check, lint, unit tests and a production build on every push to `main` and every pull request. Database tests skip in CI (they need the database key and must not write into the shared database); run them locally.
3. **Vercel** (account admin@lead96.com, managed by Riku) is connected to the GitHub repo: every push to `main` deploys to production (lead96.com) automatically, and other branches get preview URLs.
4. Check the deployment in Vercel (Deployments) and open lead96.com.

## Database changes (migrations)

- Every schema change is a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_name.sql`. **Never edit a migration that was applied**; write a new one.
- New tenant tables need `workspace_id`, row-level security on, policies through `is_member` / `is_owner` / `is_platform_admin`, a case in `tests/rls.test.ts`, and usually the change-log trigger.
- Apply: `npm run db:push` (Supabase CLI, needs Postgres port access) or `npm run db:push:https` (Management API over HTTPS; works behind a VPN). `-- --dry-run` lists what is pending.
- **Order:** apply the migration first, then deploy the code that uses it. Write migrations so the old code keeps working until the new code is live (add columns / functions, don't rename or drop in the same step).
- Today migrations go straight to the one shared database. With a separate production project: apply to development, test, then apply to production right before deploying.

## Rolling back

- **Code:** Vercel > Deployments > the last good deployment > "Instant Rollback" (or "Promote to Production"). Then fix and push.
- **Database:** there is no automatic undo. Write a new migration that reverses the change. Data mistakes: restore from backup ([Backup and restore](backup-restore.md)).

## After deploying, check

- Sign in, open the dashboard and one customer.
- Admin > Integration health: no new failures.
- Admin > All businesses: errors column.
- A failure alert email arrives within the hour if something is broken (to platform admins).

## Releases that need extra steps

- **Changed `CRON_SECRET`:** update Supabase Vault `lead96_cron_secret` too.
- **Changed `CREDENTIALS_ENCRYPTION_KEY`:** reconnect Google Ads (Admin > Google Ads).
- **Changed AI caller prompt or tools** (`src/lib/voice/agent-config.ts`): bump `VOICE_PROMPT_VERSION`, then Admin > AI voice > update each business's AI caller.
- **New auth email template:** paste it in Supabase > Authentication > Emails.
