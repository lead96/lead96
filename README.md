# Lead96 (LeadGen OS)

AI lead-generation platform for home-service contractors: leads and calls in one CRM, an AI voice agent that qualifies and books, and outcome/revenue tracking by source.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind) · Supabase (Postgres, Auth, Storage, RLS) · OpenAI · Vitest.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Supabase + OpenAI keys
npx supabase login              # once
npx supabase link               # pick the project; enter the DB password
npm run db:push                 # apply supabase/migrations
npm run dev                     # http://localhost:3000
```

In the Supabase dashboard -> Authentication -> URL Configuration, set **Site URL** to the app URL and add `<app-url>/auth/confirm` to **Redirect URLs**.

### Auth email templates

Auth emails must link to our `/auth/confirm` page with a `token_hash` (not Supabase's default `{{ .ConfirmationURL }}`). That way links work in any browser or device, and mail scanners opening the link don't use up the one-time token: it is only used when the user presses **Continue**.

Supabase only allows custom templates once **custom SMTP** is configured (free tier + built-in sender = default templates only). After setting up SMTP (Resend), for each hosted project: Supabase -> Authentication -> Emails, paste the HTML from `supabase/templates/` into the matching template (or set them via the Management API `PATCH /v1/projects/{ref}/config/auth`):

| Template | File |
|---|---|
| Confirm signup | `confirmation.html` |
| Reset Password | `recovery.html` |
| Magic Link | `magic_link.html` |
| Change Email Address | `email_change.html` |

`{{ .SiteURL }}` in the templates is the project's Site URL, so it must be the app URL for that environment. `supabase/config.toml` points to the same files for local Supabase.

Production (set 2026-10-13): Supabase sends auth emails through Resend SMTP (`smtp.resend.com:465`, user `resend`, from `no-reply@lead96.com`), **Confirm email is ON**, Site URL `https://lead96.com`. The lead96.com DNS has Resend records on `send`, `rsend` and `resend._domainkey`; the root MX/SPF/DMARC records belong to Google Workspace (admin@lead96.com mail) and must stay.

App emails (invites) go through the Resend API: `src/lib/email/send.ts` with `RESEND_API_KEY` (and optional `EMAIL_FROM`, default `Lead96 <no-reply@lead96.com>`). Addresses on reserved test domains (`.invalid`, `.test`, `example.com`, ...) are never emailed, so tests don't cause bounces. Test scripts should create users with the admin API (`email_confirm: true`) rather than the sign-up form, which now sends a confirmation email.

### Brand

Lead96 palette (brand sheet in `public/Logo`): Electric Blue `#3B82F6` (actions, links), Purple `#8B5CF6` (gradient accent only), Mint `#10B981` (success), Dark `#0B0F19` (sidebar). Tokens live in `src/app/globals.css` (`brand-*`, `accent-600`, `ink`). Use `<Logo on="light|dark" />` from `src/components/logo.tsx`; trimmed renders are in `public/brand/`, originals in `public/Logo/`. App icons are Next file conventions: `src/app/favicon.ico`, `icon.png`, `apple-icon.png` (regenerate from `public/Logo/` if the logo changes). Light SaaS look: white sidebar and cards on a pale gray page (`--color-page`), soft shadows (`shadow-card`, `shadow-menu`), line icons from `lucide-react`. Shared building blocks are in `src/components/ui.tsx` (`StatCard`, `EmptyState`, `ActionCard`, `IconTile`, `PageHeader` - header buttons go full-width on phones). The app shell is `src/app/(app)/layout.tsx` with `sidebar-nav.tsx` (also used by the phone drawer `mobile-nav.tsx`), `profile-menu.tsx` and `top-search.tsx`. Plain CRM look - no gradients or glow on UI elements.

### Setup assistant and Business profile

`/setup` is the setup chat (owners). The app asks the questions and shows answer buttons (`src/lib/setup/questions.ts`); button clicks are mapped in code (no model call, ~1 s); only typed answers go to the model (`OPENAI_CHAT_MODEL`, default `gpt-4.1-nano`, with a compact prompt). The campaign plan uses `OPENAI_MODEL` (`gpt-4.1-mini`). It collects the demand profile, AI call settings and creates a campaign plan. `/profile` shows and edits the same data with forms, and regenerates the plan. Every value the model extracts is validated in `src/lib/setup/draft.ts`; plan numbers are computed in `src/lib/setup/plan.ts`. Prompts and JSON schemas are in `src/lib/setup/prompts.ts` - bump the prompt version when changing them. AI calls use `store: false` and are logged per workspace in `usage_records`.

### Leads and landing pages (M2)

Every lead or call - from any source - goes through `ingestLead()` (`src/lib/leads/ingest.ts`) -> `ingest_lead()` in Postgres. It normalizes phone/email, matches an existing customer by phone or email (under a per-workspace lock), ignores repeat deliveries of the same `source + external_id`, and writes `lead.received` / `customer.created` events. Only the service role can call it; callers must check permission first. Customer status and notes change only through `set_customer_status()` / `update_customer_notes()`, which log an event.

Landing pages (`/landing-pages`) are template + JSON content (`src/lib/landing/content.ts`), rendered by `src/components/landing/landing-page.tsx` both in the editor preview and publicly at `/p/{slug}`. Public submissions (`src/app/p/actions.ts`) store UTM/click IDs and a consent record; the consent text is versioned (`CONSENT_VERSION`).

### Imports and call intake (M2)

`/leads/import` (owners) imports a CSV: the browser parses it (`src/lib/leads/csv.ts`), the owner confirms the column mapping, and rows go to `importLeads` in chunks of 200 -> `ingest_leads()` (one database call per chunk; a bad row is reported, not fatal). Each row's id is a hash of its content, so re-importing a file adds nothing.

`POST /api/intake/call` receives calls (payload v1 in `src/lib/intake/call.ts`). Requests must be signed: `X-Lead96-Timestamp: <unix seconds>` and `X-Lead96-Signature: v1=<hex HMAC-SHA256(INTAKE_SIGNING_SECRET, "<timestamp>.<body>")>` (`src/lib/intake/signature.ts`). Responses: 200 stored or already stored · 401 bad signature · 422 invalid / no caller number (don't retry) · 500 retry. Every signed delivery is logged in `webhook_deliveries`. Send a test call with `npm run intake:test-call -- --workspace <id>`.

### Admin and integration health

`/admin` is for platform admins (`profiles.is_platform_admin`, set in the database - users can't set it themselves). It shows a health card per integration built from `admin_integration_health()` (aggregates only) and the rules in `src/lib/admin/health.ts`, which credentials are set (names only, from env), a per-business table and the webhook delivery feed. **Run live checks** (`src/lib/admin/checks.ts`) calls each service with a free, read-only request. When Meta or Google lead sync ships, flip `BUILT` in `health.ts`.

Agency-model credentials (server env, all optional until that integration is used): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_MANAGER_ID`, `GOOGLE_ADS_REFRESH_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `META_BUSINESS_ID`.

### Google Ads (M2)

Agency model: one Google user with access to the Lead96 manager account signs in once at **Admin -> Google Ads** (`/api/google/connect` -> `/api/google/callback`). The refresh token is stored AES-256-GCM encrypted in `platform_connections` (key: `CREDENTIALS_ENCRYPTION_KEY`; changing the key means reconnecting). Local and live share the database, so connecting once works for both as long as they use the same key. Each ad account under the manager account is assigned to a business (`ad_accounts`).

- **Real-time leads:** each assigned account has a webhook URL `/api/intake/google-lead/<account id>` and key, pasted into the lead form in Google Ads (Lead delivery -> Webhook). Test leads are logged, not stored.
- **Daily sync:** `/api/cron/google-sync` (Vercel Cron, `vercel.json`, protected by `CRON_SECRET`) pulls lead-form submissions (catch-up) and 3 days of campaign spend into `ad_spend_daily`; **Sync now** in Admin pulls 30 days.
- API calls are plain REST (`src/lib/google/ads.ts`, version `GOOGLE_ADS_API_VERSION`, default v25); mapping is in `src/lib/google/leads.ts`.

### AI voice (M3)

Lead96 owns one Retell account (agency model). Each business gets its own Retell LLM + agent, built from its setup by `src/lib/voice/agent-config.ts` (services, area, visit hours, qualification questions, transfer number, emergency rules; the AI says it is an AI and that the call may be recorded). **Admin > AI voice** creates/updates it ("Update from setup" only pushes when something changed; every pushed config is kept in `voice_agent_versions`), runs a **browser test call** (microphone, no phone number needed), buys US numbers and assigns them to businesses.

- **Webhook:** `POST /api/voice/retell` (agent `webhook_url`), signed with the Retell API key (`x-retell-signature: v=<ms>,d=<hmac>`, 5 min). Saves each call in `calls` (status, outcome, summary, answers, transcript, cost), copies the recording into the private `call-recordings` bucket, adds a `call.completed` timeline event, moves the customer forward (new/contacted to contacted/qualified), sets `do_not_call` when asked, logs voice minutes in `usage_records`. Inbound calls become call leads for the caller. Retell cannot reach localhost, so agents synced from a local app send webhooks to https://lead96.com (same database).
- **Outcome:** how the call ended first (no answer, voicemail, transfer, do-not-call), then the AI's own analysis; unsure (confidence below 0.6), unclear or emergency calls get `needs_review`.
- **Automatic calls (fast callback):** when an owner turns them on (Settings > AI caller), every new form lead (landing page, Google, later Meta) gets a `call_jobs` row and the AI calls right away. `src/lib/voice/eligibility.ts` decides every call: auto-call on, AI caller + number, US phone, not do-not-call, consent to AI calls (Google/Meta forms have none yet, so they are skipped), inside the service area, not called in the last 12 h, customer not already booked/won/lost, and calling hours 8am-8pm business time (outside them the job waits for the morning). No answer or voicemail plans a retry (15 min, then 3 h; 3 attempts). One open job per customer (unique index), so duplicate leads never cause two calls. Skips and failures show on the customer timeline.
- **Calls in the app:** `/calls` lists every AI call (test calls hidden) with a **Needs review** tab; `/calls/<id>` shows the outcome, AI confidence, summary, the answers labelled with the business's own questions (`src/lib/voice/present.ts`), the recording (signed URL from the private bucket) and the transcript. Any member (staff too) can correct the outcome and mark the call reviewed through `review_call()`; the AI's original outcome is kept in `original_outcome` and the change is on the timeline. The customer page has an **AI calls** card and **Call now with AI** (same consent / area / do-not-call / hours rules, disabled with the reason when it cannot call).
- **Incoming calls:** numbers bound to an agent get `inbound_webhook_url` = `/api/voice/inbound` (signed). A known caller (same phone in that business) is greeted by name ("Am I speaking with Maria?") with what they asked about; the call is tagged with the business and customer. On any failure Retell connects the number's agent with the default greeting.
- **In-call tools** (`/api/voice/tools/<name>`, signed): `check_availability` returns morning/afternoon visit windows for the next 5 open days from the visit hours (`src/lib/voice/availability.ts`, 2 h notice for today); `book_appointment` accepts only a window check_availability offers, saves it on the call (`calls.appointment`) and as `appointment.requested` on the customer timeline, and the call's outcome becomes **booked**. No calendar yet: the team confirms the visit (M4 makes this a real booking).
- **Texts (no Twilio):** each business also gets a Retell **text agent** (chat agent + its own LLM, `src/lib/voice/sms-config.ts`), bound to its number for SMS. When the **first** automatic call goes unanswered, the lead gets one text from the business number (`noAnswerText`: business name, why, callback number, "Reply STOP to opt out"); replies are answered by the text agent. Rules (`decideText`): consent on the lead, not do-not-contact, US number, 8am-8pm business time, at most one text conversation per person per 24 h, once per call. Conversations are saved in `messages` (first text, transcript, summary, replied); the chat_* webhook events go to the same `/api/voice/retell`. A reply moves the customer forward ("Replied to a text"); STOP / opt-out marks them do-not-contact. Delivery to US phones may need SMS registration in the Retell dashboard.
- **Scheduler:** pg_cron runs `public.call_runner_tick()` every minute; when a job is due it posts to `/api/cron/calls` (Bearer `CRON_SECRET`), which claims jobs atomically (`claim_call_jobs`). The URL and secret live in Supabase Vault (`lead96_call_runner_url`, `lead96_cron_secret`), set once per environment, never in git.
- **Numbers:** Retell needs a one-time identity check (KYC) before numbers can be bought by API; it starts when the first number is bought in the Retell dashboard.
- Env: `RETELL_API_KEY` (required), `RETELL_VOICE_ID` (default retell-Cimo), `RETELL_LLM_MODEL` (default gpt-5.6-terra); `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` for SMS later.

### ZIP code data

`public.us_zip_codes` holds ~41k US ZIPs with city, state and coordinates, from [GeoNames](https://www.geonames.org) postal codes (CC BY 4.0 - keep the attribution). The CSV is in `supabase/seed/us_zip_codes.csv`; load it with `npm run db:seed:zips` after the migration (idempotent). The setup chat uses `zip_city_matches` / `zips_within` to turn "Miami, 20 miles" into a ZIP list - the AI never generates ZIP codes.

### Calendar (M4)

Lead96 has its own calendar (Google Calendar sync comes later). Visits are **arrival windows**: the visit hours from the setup are split at noon into morning / afternoon windows (`src/lib/voice/availability.ts`). The availability engine (`src/lib/calendar/slots.ts`) removes windows that are full, days that are full and blocked days: capacity is the setup's "jobs per day" spread over that day's windows (without it, one visit per window). Times are converted with the business time zone (`localToUtc`, DST-safe).

- **Booking** goes through `book_window()` (migration 019): it takes a per-business advisory lock and re-checks blocked days, the window and the day before inserting, so parallel callers can never take the last place twice (tested with 5 parallel bookings). The AI's `book_appointment` tool and the team's **Book visit** (customer page) both use `bookWindow()` in `src/lib/calendar/service.ts`. A booking moves the customer to Appointment and adds a timeline entry; an unknown inbound caller who books becomes a customer at once.
- **Calendar page** (`/calendar`): visits by day with Confirm / Done / No-show / Move / Cancel (`set_appointment_status()`, `reschedule_appointment()`), Done moves the customer to Showed, Cancel frees the place. Owners block days (`calendar_blackouts`); visits already booked on those days stay.
- **Visit messages** (migration 020, `src/lib/notify/visits.ts`): a trigger on `appointments` plans `notification_jobs` - on booking a confirmation to the customer and a "new visit" email to the owners, plus reminders 24 h and 2 h before (only if still in the future); a move cancels the old reminders and plans a "visit moved" email and new reminders; a cancel drops what is still queued and sends a cancellation. The per-minute runner (`/api/cron/calls`) sends due jobs by email (Resend, sender name = the business, reply-to = the owner, idempotency key per job). Customers without an email and test addresses are skipped with the reason; other failures retry 3 times, 5 minutes apart. Each sent email shows on the customer timeline. SMS reminders wait for US texting registration (A2P).

### Dashboard (M5)

`/dashboard` reports a **cohort**: people whose first contact falls in the chosen period (last 7 / 30 / 90 days, this month, last month, in the business time zone - `periodFor()` in `src/lib/dashboard/report.ts`), and how far each got: qualified, booked, showed, won, revenue. The counts come from `dashboard_report()` (migration 024, runs as the caller so RLS applies). A stage counts if it was ever reached (a job later lost still counts as booked); a cancelled visit does not count as booked.

- **Channel = first touch**, from `lead_channel()`: a landing page lead with a Google click ID or `utm_source=google` is **Google Ads**, with a Facebook click ID or `utm_source=facebook` / `instagram` it is **Facebook / Instagram ads**; otherwise the lead's source (landing page without an ad click, phone call, CSV, added by hand).
- **Cost:** ad spend per platform for the same days (`ad_spend_daily`) goes on its channel: cost per lead and **cost per booking (CPQBA)** = spend / booked visits. Spend with no leads still shows. Spend is assumed to be in USD.
- **Attribution views:** the table switches between Source, Campaign, Landing page, Ad and Keyword (`?by=`, kept together with the period). `attribution_report()` (migration 025) groups the same cohort (`cohort_funnel()`) by the first lead's campaign (campaign ID or utm_campaign), landing page, ad (ad ID or utm_content) or keyword (keyword or utm_term, lower-cased), per channel. Campaign spend is matched in `buildAttribution()` by campaign ID, or by name for leads that only carry utm_campaign; spend no lead matched gets its own row. Ads, keywords and landing pages show no spend (it is synced per campaign). Top 50 rows; the total counts all.

### Review queue (M5)

`review_items` (migration 026) are filed by database triggers, never by hand:

- from AI calls (`file_call_reviews`, test calls never): **AI unsure** (confidence under 60%), **Emergency**, **Unclear call** (outcome other), **Call failed**, **Unknown service** (the person talked, the AI matched no service);
- from outcomes (`file_outcome_reviews`): **AI and result disagree** (AI said not a fit / not interested / wrong number but the job showed or was won, or AI said qualified / booked and the team marked it not qualified) and **High-value job** (won at $10,000+ or 3x the business's average win).

`/review` (count in the menu) shows each with what the AI said, the real result, the call summary and a link to the call. **Approve / Correct / Reject / Not sure** go through `resolve_review_item()`: a correction is applied to the record (call outcome, keeping the AI's in `original_outcome`; the customer's service; revenue via `set_outcome`), and before / after, reason, reviewer and time are stored (the learning record) plus a timeline entry. "Not sure" keeps the item aside in its own tab; "Done" lists the last 50 decisions. Reviewing a call on its own page closes its open call items too.

### Outcomes (M5)

The job result lives on the customer (migration 022): status **Not qualified** (with a reason), the estimate amount, the revenue of a **Won** job and the reason a job was **Lost** (lists in `src/lib/leads/outcomes.ts`). Every change goes through `set_outcome()`, which enforces the rules in the database too (won needs revenue, lost / not qualified need a reason) and writes a timeline event with who, when, amount, reason and note; correcting the amount keeps the first close date.

- **Customer page:** one "Status and result" form; Estimate, Revenue and Reason show on the Contact card.
- **Outcomes page** (`/outcomes`, count in the menu): past visits still booked (Done / No-show / Did not happen) and done visits whose job has no final result (inline result form). It also shows the share of visits older than 7 days (last 90 days) with a final result, against the 80% pilot target.
- **Reminder email:** weekdays at 14:00 UTC pg_cron runs `plan_outcome_reminders()`, which queues one "results to record" email per business with something pending (at most one a day); the per-minute runner sends it to the owners. `plan_outcome_reminders(<business id>)` limits it to one business (tests).

### US texting registration

US carriers need each contractor registered as the sender before the AI may text (A2P 10DLC; Retell: one business profile, brand and campaign per contractor, dashboard only, no API). Owners fill in **Settings > Texting** (legal name, business type, EIN, website, address, contact) and send it to Lead96; values are checked in `src/lib/texting/registration.ts` and saved through `save_texting_registration()` (migration 021), which only lets owners change it while it is a draft or was sent back. Staff never see it (it holds the EIN), and the change history leaves the EIN out. Platform admins work through **Admin > Texting**: every field plus the campaign text written for that contractor (description, samples, opt-in with the real consent text and landing page URL) with copy buttons, and set the status (filed, approved, needs changes with a note the owner sees). Approving re-links the business's numbers in Retell so texts start at once.

### Change history

Every insert, update and delete on the important tables (businesses, members, invites, customers, leads, calls, texts, landing pages, setup, AI callers, phone numbers, ad accounts, user profiles) is written to `change_log` by a database trigger (`log_change()`, migration 018): who (`auth.uid()`, or "system" for webhooks, jobs and scripts), when, and the old and new values (updates keep only the changed fields). Secrets (invite tokens, webhook keys) and call/text transcripts are left out. The table is append-only (a trigger refuses updates and deletes, even from the service role) and has no foreign key to businesses, so deleting a business keeps the record of what was deleted. Owners read their own business's history; platform admins read everything at **Admin > Change history** (filter by business, what, who).

### Team invites

Owners invite from **Settings**. The invite is emailed (Resend) and the link is also shown, so the owner can share it another way if the email fails. The link opens `/invite/<token>`, which works signed in or out and explains wrong-account, expired, used and cancelled cases. Invites also appear on `/onboarding` for anyone signed in with the invited (verified) email.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (webpack; Turbopack crashes on some Windows setups) |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Vitest. `tests/rls.test.ts` checks tenant isolation against the linked Supabase project (skipped without env) |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:push:https` | Same, through the Supabase Management API over HTTPS - use when a VPN blocks Postgres ports. Needs `SUPABASE_ACCESS_TOKEN` in `.env.local`. `-- --dry-run` lists pending migrations |
| `npm run db:seed:zips` | Load the US ZIP code table from `supabase/seed/us_zip_codes.csv` |
| `npm run intake:test-call` | Send a signed test call to `/api/intake/call` (`-- --workspace <id> [--url ...] [--status missed] [--source google] [--call-id ...]`) |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` |

## Layout

```
src/
  app/
    page.tsx              public home ("what leads do you want?")
    (auth)/               login, signup, password reset + server actions
    auth/confirm/         email-link landing (PKCE code / token_hash)
    onboarding/           create the business workspace
    invite/[token]/       accept a team invite
    (app)/                signed-in app: dashboard, setup, leads, settings, ...
  components/ui.tsx       small UI primitives
  lib/
    auth.ts               current user / workspace helpers
    supabase/             server, browser, proxy and admin clients
  proxy.ts                session refresh + auth redirect (Next 16 "proxy")
supabase/migrations/      schema, RLS, reference data
tests/                    integration tests
```

## Principles

- **Tenant isolation in the database.** Every tenant table has `workspace_id` and RLS. The service-role client (`createAdminClient`) bypasses RLS and is only for trusted server code that scopes by workspace explicitly.
- **History is append-only.** State changes are written to `events`; nothing overwrites history.
- **Vertical-agnostic core.** Taxonomy and qualification questions are data (`taxonomy_values`, `qualification_question_templates`), seeded for HVAC.
- **Schema changes only through migrations** in `supabase/migrations`.
