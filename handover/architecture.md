# Architecture

## Parts

```
 Homeowner                 Contractor / team              Lead96 admins
     |                            |                             |
 landing page (lead96.com/p/x)   app (lead96.com)               Admin pages
     |                            |                             |
     +------------- Next.js on Vercel (server actions, API routes, proxy) -------+
                     |              |              |             |
                Supabase        Retell AI        Resend      Google Ads / Meta / OpenAI
          (Postgres + Auth +   (AI calls,      (emails)
             Storage + cron)    numbers, SMS)
```

- **Next.js app** (`src/app`): pages for contractors (`(app)`), sign-in (`(auth)`), public landing pages (`p/[slug]`), legal pages, and API routes (`api/`) for webhooks and scheduled work. `src/proxy.ts` refreshes the session on every request, sends signed-out users to sign-in and users with two-factor to the code page.
- **Supabase**: all data in Postgres with row-level security per business; sign-in (email + password, optional authenticator code); file storage (landing page images, call recordings); `pg_cron` + `pg_net` for scheduled work; Vault for the two secrets the database needs.
- **Server-only keys** (service role, Retell, Resend, Google, OpenAI) are used only in server code; the browser gets the public Supabase URL and anon key only.

## A lead, end to end

1. **Lead arrives**: landing page form (`src/app/p/actions.ts`), CSV import, manual entry, tracked call (`/api/intake/call`), Google lead form (`/api/intake/google-lead/<account>`), or a phone call answered by the AI (`/api/voice/inbound`). All go through `ingest_lead()`, which finds or creates the **customer** (same phone or email = same person) and stores the **lead** with its source data and consent.
2. **Fast callback**: if the business turned on automatic calls and the person consented, a **call job** is queued. The per-minute runner starts the Retell call within the contact window; no answer -> retries and (once US texting is approved) a text.
3. **AI call**: Retell runs the conversation with the business's AI caller (questions, service area, hours). During the call it uses our tools `check_availability` and `book_appointment` (`/api/voice/tools/<name>`), which book a real visit window through `book_window()` (no double booking).
4. **After the call**: Retell posts the result to `/api/voice/retell`: transcript, summary, outcome, recording (copied into our storage). Unsure or unusual calls are filed in the **review queue**.
5. **Visit**: confirmation email, reminders 24 h and 2 h before, "moved" / "cancelled" emails, and a "new visit" email to the owners (notification jobs, sent by the runner).
6. **Outcome**: the team records done / no-show, then won (revenue), lost (reason) or not qualified on the Outcomes page; weekday reminder emails when results are missing.
7. **Reporting**: the dashboard shows the funnel and cost per booked visit by source, campaign, landing page, ad and keyword; data health checks flag missing or inconsistent data.

## Background work

| What | Trigger | Where |
|---|---|---|
| Calls, visit messages, failure alerts | `pg_cron` every minute runs `call_runner_tick()`; when something is due it calls `POST /api/cron/calls` (secret in Vault) | `src/app/api/cron/calls`, `src/lib/voice/jobs.ts`, `src/lib/notify/` |
| Results-to-record reminder | `pg_cron` weekdays 14:00 UTC, `plan_outcome_reminders()` | queued as a notification job |
| Failure alert planning | `pg_cron` hourly at :05, `plan_ops_alert()` | queued in `ops_alerts` |
| Google Ads leads and spend | Vercel Cron daily 10:00 UTC, `GET /api/cron/google-sync` | `src/lib/google/` |

## Multi-tenancy and security

- Every business is a **workspace**; every tenant table has `workspace_id`. Row-level security lets members read their business, owners change settings, platform admins see everything. All checks go through `is_member` / `is_owner` / `is_platform_admin` / `shares_workspace`, which also enforce two-factor for users who turned it on.
- Writes that need rules (booking, outcomes, reviews, merges, statuses) go through database functions that check the caller and log an event; a change log trigger records who changed what on the important tables.
- Webhooks are verified (Retell HMAC signature, intake HMAC, per-account keys); cron routes need `CRON_SECRET`.
- Details: [Database](database.md), security review in the internal docs (`docs/09-security-review.md`).
