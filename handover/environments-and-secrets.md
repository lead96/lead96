# Environments and secrets

## Environments today

| | Where | Database |
|---|---|---|
| Production | Vercel, https://lead96.com | Supabase project `jrtbcaxxqiondfpyghey` |
| Development | `npm run dev` on a developer machine, http://localhost:3000 | **the same project** |

Development and production share one database. Test scripts create and delete their own test accounts (`@test.leadgen.invalid`) and businesses, but a mistake in development reaches real data. A separate production project is planned (see [Backup and restore](backup-restore.md)); when it exists, this page and the Vercel settings change.

## App settings (environment variables)

Set in `.env.local` for development (never committed; `.env*` is git-ignored) and in **Vercel > Project > Settings > Environment Variables** for production. Values live in the password manager, never in this repository or in chats. `src/lib/env.ts` checks them at start-up.

| Variable | Needed for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything | Public by design (the browser uses them); data is protected by row-level security |
| `NEXT_PUBLIC_APP_URL` | Links in emails, OAuth redirects | `https://lead96.com` in production |
| `SUPABASE_SERVICE_ROLE_KEY` | Server work that bypasses row-level security (webhooks, jobs, admin pages) | Full database access: server only, never in the browser |
| `CRON_SECRET` | `/api/cron/*` | Same value in Vercel and in Supabase Vault `lead96_cron_secret` |
| `CREDENTIALS_ENCRYPTION_KEY` | Encrypting the stored Google sign-in | 64 hex characters. Changing it makes the stored sign-in unreadable: reconnect Google Ads after |
| `RESEND_API_KEY`, `EMAIL_FROM` | App emails | `EMAIL_FROM` default `Lead96 <no-reply@lead96.com>` |
| `OPS_ALERT_EMAILS` | Failure alerts | Optional; comma-separated. Default: every platform admin |
| `RETELL_API_KEY` | AI calls, numbers, texts; also verifies Retell webhooks | `RETELL_VOICE_ID`, `RETELL_LLM_MODEL` optional |
| `OPENAI_API_KEY` | Setup chat, campaign plan | `OPENAI_MODEL`, `OPENAI_CHAT_MODEL` optional |
| `INTAKE_SIGNING_SECRET` | `/api/intake/call` (tracked calls) | Intake is off when unset |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Ads sign-in | OAuth client in Cloud project 255729401612. The client ID starts with that project number |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API | Ignored by Google since v25 (access comes from the Cloud project) but still sent |
| `GOOGLE_ADS_MANAGER_ID` | Google Ads API | `151-473-9298` |
| `GOOGLE_ADS_API_VERSION` | Google Ads API | Default `v25` |
| `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `META_BUSINESS_ID` | Meta (when built) | Not set yet |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Not used (texting runs through Retell) | Can be removed |
| `SUPABASE_ACCESS_TOKEN` | Scripts only: `db:push:https`, `db:export` | Personal access token of the Supabase account owner; development machine only, not in Vercel |

After changing a variable in Vercel, **redeploy** (Deployments > ... > Redeploy) for it to take effect.

## Secrets inside the database (Supabase Vault)

| Name | Value |
|---|---|
| `lead96_call_runner_url` | `https://lead96.com/api/cron/calls` |
| `lead96_cron_secret` | Same as `CRON_SECRET` |

Change in Supabase > Project Settings > Vault. If `CRON_SECRET` changes in Vercel, change it here too, or calls, visit emails and alerts stop.

## Supabase settings (dashboard)

- **Authentication > URL Configuration:** Site URL `https://lead96.com`; redirect URLs include `https://lead96.com/**` and `http://localhost:3000/**`.
- **Authentication > Emails / SMTP:** custom SMTP through Resend (`smtp.resend.com:465`, user `resend`, from `no-reply@lead96.com`); confirm email ON; templates from `supabase/templates/` (see the main README).
- **Authentication > Providers / Policies:** minimum password 8; two-factor (TOTP) enabled.
- **Storage:** buckets `landing-assets` (public, PNG / JPEG / WebP, 2 MB) and `call-recordings` (private).

## DNS (lead96.com at GoDaddy)

- `@` A `216.198.79.1` and `www` CNAME to Vercel (website).
- Resend records on `send`, `rsend` and `resend._domainkey` (email sending).
- Root MX, SPF and DMARC belong to **Google Workspace** (admin@lead96.com mailbox): never remove them.

## Accounts that hold settings outside the code

- **Retell:** agents and phone numbers are created by the app (Admin > AI voice); webhook URLs are set per agent by the app to `https://lead96.com/api/voice/...`.
- **Google Cloud project 255729401612:** OAuth consent screen, OAuth client (redirect URIs `https://lead96.com/api/google/callback` and `http://localhost:3000/api/google/callback`), Google Ads API access level (Explorer since 2026-10-16).
- **Vercel Cron:** defined in `vercel.json` (Google sync daily 10:00 UTC).
