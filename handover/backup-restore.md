# Backup and restore

## Today (2026-10-16)

- **No automatic backups.** The Supabase project is on the free plan, which keeps no database backups (Supabase reports an empty backup list). A deleted table, a bad migration or a mistake in development (which shares the database) can't be undone from Supabase.
- **Safety copy:** `npm run db:export` (add `-- --files` to include stored files) writes every table as JSON, the sign-in accounts (without passwords) and the list of stored files into `backups/<timestamp>/` on the machine that runs it (git-ignored). It needs `SUPABASE_ACCESS_TOKEN` in `.env.local`. About 4 MB today.
  - Run it at least weekly and before risky changes; keep copies where only owners can read them (they contain customer data and encrypted secrets). Delete old copies you don't need.
- **Code** is safe in GitHub; **configuration** is in [Environments and secrets](environments-and-secrets.md) and the password manager.

## Target before the pilot ("3 copies")

1. **Supabase Pro** ($25 / month): daily backups kept 7 days, restorable from the dashboard (Database > Backups). Optional point-in-time recovery (add-on) to restore to any minute.
2. **A separate production project**, so development and tests never touch customer data.
3. **Weekly offsite copy:** `npm run db:export -- --files` (or `supabase db dump` where the Postgres port is reachable) stored outside Supabase (e.g. an encrypted folder owned by Halawa GmbH).
4. **Restore test** once after setup and then quarterly: restore the latest backup into a scratch project, point a local app at it, sign in, open a business and a customer. Write the date and result here.

## Restoring

**From a Supabase backup (Pro):** Supabase > Database > Backups > Restore. This replaces the whole database with the backup; everything after it is lost, so export first if the current state has anything worth keeping. Storage files are not part of database backups.

**From a `db:export` copy (manual):**

1. Create an empty Supabase project, or use the damaged one after making a fresh export of it.
2. Apply all migrations (`npm run db:push:https` with that project's URL and token) so the schema exists.
3. Re-create the sign-in accounts from `auth_users.json` with the Admin API (same `id` and email; users then reset their password).
4. Load the tables in dependency order (workspaces, profiles, workspace members, customers, leads, then the rest), with triggers paused for the load (`set session_replication_role = replica;`) so the load doesn't re-plan emails or write change history. Load `events`, `change_log` and `audit_log` last.
5. Upload files from `files/` back to the same bucket and path.
6. Re-seed reference data if needed (`npm run db:seed:zips`), check Vault secrets and cron jobs, sign in and spot-check.

This is a developer task of a few hours; the Pro backups above are the normal path.
