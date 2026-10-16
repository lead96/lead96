# Operations (runbooks)

## Where to look first

- **Admin > All businesses:** every business with leads, calls, open reviews, missing results, data health and errors in the last 7 days; latest failures of every kind; admin actions.
- **Admin > Integration health:** webhooks and integrations per provider; live checks.
- **Failure alert emails** (to platform admins, at most hourly): counts and examples of what failed.
- **Vercel > Logs** for server errors; **Supabase > Logs** for database / auth.

## "Calls, visit emails or alerts stopped"

All three run through one per-minute job. Check in order:

1. Supabase SQL: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'lead96-call-runner') order by start_time desc limit 5;` - is it running and succeeding?
2. Supabase SQL: `select status_code, content from net._http_response order by created desc limit 5;` - what did lead96.com answer? `401` = `CRON_SECRET` in Vercel and Vault `lead96_cron_secret` differ. `5xx` = app error (Vercel logs).
3. Vault `lead96_call_runner_url` must be `https://lead96.com/api/cron/calls`.
4. Overdue work: the query under "Useful queries" in [Database](database.md).

## "An AI call failed / the AI behaved wrongly"

- The call page (Calls > the call) shows the transcript, recording, outcome and the AI's confidence. Correct the outcome there or in **Review**.
- Provider errors (no credit, number problem) show in Admin > All businesses > Latest failures and in the alert email; check the Retell dashboard (balance, number status).
- Prompt or tool changes: `src/lib/voice/agent-config.ts`, then Admin > AI voice > update the business's AI caller.

## "Emails don't arrive"

- `notification_jobs` / `ops_alerts`: status `failed` or `skipped` with the reason (no email address, test address, Resend error).
- Resend dashboard > Logs (bounces, blocks). The domain must stay verified (DNS records in [Environments and secrets](environments-and-secrets.md)).
- Sign-in emails: Supabase > Authentication > Logs, and the SMTP settings.

## "Google Ads shows an error"

- `UNAUTHENTICATED` / "sign-in expired": Admin > Google Ads > Reconnect (as admin@lead96.com).
- `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`: the Cloud project's API access level dropped to Test; check Cloud Console > Google Ads API overview.
- No ad accounts listed: none are linked under the manager account yet.

## Onboarding a pilot business

1. The owner signs up at lead96.com, creates the business and finishes the setup chat (services, area, hours, questions).
2. Admin > AI voice: create the AI caller, buy a number (area code of the business), assign it; run a browser test call.
3. Owner: publish a landing page; check the consent checkbox shows the business name.
4. Owner: Settings > Texting, send the details; admin files the US texting registration in Retell (Admin > Texting) - takes 2-3 weeks.
5. Google Ads: link the contractor's ad account to the manager account; assign it in Admin > Google Ads; add the lead form webhook URL and key in their lead form.
6. Owner: Settings > automatic calls on; invite the team.
7. Send a test lead through the landing page; watch the call, booking, emails and dashboard.

## Accounts and access

- **Make or remove a platform admin:** Supabase SQL `update profiles set is_platform_admin = true|false where email = '...';` (logged in the change history).
- **Lost phone (two-factor):** Supabase > Authentication > Users > the user > remove the MFA factor. They sign in with the password and turn two-factor on again in Settings.
- **Remove a team member:** the owner does it in Settings > Team.
- **Delete a business** (rare, e.g. tests): Supabase SQL `delete from workspaces where id = '...';` deletes its data; the change history keeps the record.

## Rotating a secret

| Secret | Steps |
|---|---|
| `CRON_SECRET` | New random value (32+ chars) in Vercel and in Vault `lead96_cron_secret`; redeploy |
| `RETELL_API_KEY` | New key in Retell; set in Vercel; redeploy; webhooks are verified with the new key right away |
| `RESEND_API_KEY`, `OPENAI_API_KEY` | New key in the provider, set in Vercel, redeploy, delete the old key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > API keys: rotate; set in Vercel and `.env.local`; redeploy |
| `GOOGLE_CLIENT_SECRET` | New secret on the OAuth client; set in Vercel; redeploy; Reconnect Google Ads |
| `CREDENTIALS_ENCRYPTION_KEY` | Only if leaked: new 64-hex value, redeploy, Reconnect Google Ads |

## Test data hygiene

Test scripts create users on `@test.leadgen.invalid` and delete them at the end; a crashed run can leave some behind. Check with Supabase SQL: `select email from auth.users where email like '%@test.leadgen.invalid';` and remove them (Authentication > Users) together with businesses only they belong to.
