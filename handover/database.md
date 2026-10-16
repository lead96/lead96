# Database

Supabase Postgres 17, project `jrtbcaxxqiondfpyghey` (US East). The schema is defined only by the files in `supabase/migrations/` (32 at handover), applied in order.

## Main tables

| Area | Tables |
|---|---|
| Accounts and businesses | `profiles` (one per sign-in; `is_platform_admin`), `workspaces` (a business), `workspace_members` (owner / staff), `workspace_invites` |
| Setup | `demand_profiles`, `agent_settings` (AI questions), `campaign_plans`, `setup_conversations`, reference data `taxonomy_values`, `qualification_question_templates`, `us_zip_codes` |
| Leads and customers | `customers` (one person per business; status, outcome, revenue; `merged_into` for merged duplicates), `leads` (each contact with source, campaign, click IDs, consent), `landing_pages` |
| AI voice and texts | `voice_agents`, `voice_agent_versions`, `phone_numbers`, `calls`, `call_jobs` (queued callbacks), `messages` (texts), `texting_registrations` (US SMS registration per contractor) |
| Calendar | `appointments` (visit windows), `calendar_blackouts`, `notification_jobs` (visit emails, reminders, results-to-record emails) |
| Ads | `ad_accounts`, `ad_spend_daily`, `platform_connections` (encrypted Google sign-in) |
| Quality and audit | `review_items` (review queue), `events` (customer timeline, append-only), `change_log` (who changed what, append-only), `audit_log` (admin actions), `webhook_deliveries`, `usage_records` (AI usage), `ops_alerts` (failure alerts) |

## Access rules (row-level security)

- Every table has row-level security on. Signed-out visitors have no table rights at all.
- Members read their own business; owners change settings, team and integrations; platform admins (Lead96) see all businesses.
- All rules go through four functions: `is_member(workspace)`, `is_owner(workspace)`, `is_platform_admin()`, `shares_workspace(user)`. Each also checks `mfa_ok()`: a user who turned on two-factor must have entered a code in this session.
- Writes with business rules go through `security definer` functions that check the caller: `book_window`, `reschedule_appointment`, `set_appointment_status`, `set_outcome`, `resolve_review_item`, `merge_customers`, `save_texting_registration`, `ingest_lead` (server only), and others. They log to `events`.
- Server code with the service-role key bypasses row-level security (webhooks, jobs, admin pages); it is never sent to the browser.
- `tests/rls.test.ts` checks these rules against the real project (each new table gets a case).

## Scheduled jobs (pg_cron)

| Job | Schedule | Does |
|---|---|---|
| `lead96-call-runner` | every minute | `call_runner_tick()`: if call jobs, notification jobs or alerts are due, calls `POST https://lead96.com/api/cron/calls` with the cron secret (both from Vault) |
| `lead96-outcome-reminders` | weekdays 14:00 UTC | `plan_outcome_reminders()`: one results-to-record email per business with pending visits |
| `lead96-ops-alerts` | hourly at :05 | `plan_ops_alert()`: queues a failure alert when something failed |

See them in Supabase > Integrations > Cron, or `select * from cron.job`. Run history: `select * from cron.job_run_details order by start_time desc limit 20`.

## Useful queries (Supabase > SQL Editor)

```sql
-- What failed in the last day
select public.ops_failures(now() - interval '1 day', now());

-- Queued work that should have run
select 'call' k, id, run_at from call_jobs where status = 'queued' and run_at < now() - interval '15 minutes'
union all
select 'message', id, run_at from notification_jobs where status = 'queued' and run_at < now() - interval '15 minutes';

-- Platform admins
select email from profiles where is_platform_admin;
```

## Notes

- Dates are stored in UTC (`timestamptz`); each business has a `timezone` used for hours, visit windows and reports.
- Phone numbers are stored as E.164 (`+12145550100`); emails lower-case.
- `events`, `change_log` are append-only (a trigger refuses updates and deletes). Deleting a business deletes its data but keeps its change history.
