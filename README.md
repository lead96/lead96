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

In the Supabase dashboard → Authentication → URL Configuration, set **Site URL** to the app URL and add `<app-url>/auth/confirm` to **Redirect URLs**.

### Auth email templates

Auth emails must link to our `/auth/confirm` page with a `token_hash` (not Supabase's default `{{ .ConfirmationURL }}`). That way links work in any browser or device, and mail scanners opening the link don't use up the one-time token: it is only used when the user presses **Continue**.

Supabase only allows custom templates once **custom SMTP** is configured (free tier + built-in sender = default templates only). After setting up SMTP (Resend), for each hosted project: Supabase → Authentication → Emails, paste the HTML from `supabase/templates/` into the matching template (or set them via the Management API `PATCH /v1/projects/{ref}/config/auth`):

| Template | File |
|---|---|
| Confirm signup | `confirmation.html` |
| Reset Password | `recovery.html` |
| Magic Link | `magic_link.html` |
| Change Email Address | `email_change.html` |

`{{ .SiteURL }}` in the templates is the project's Site URL, so it must be the app URL for that environment. `supabase/config.toml` points to the same files for local Supabase.

Supabase's built-in email sender only delivers to the project's team members and a few emails per hour. Before real users sign up, configure custom SMTP (Resend) under Authentication → SMTP.

### Brand

Lead96 palette (brand sheet in `public/Logo`): Electric Blue `#3B82F6` (actions, links), Purple `#8B5CF6` (gradient accent only), Mint `#10B981` (success), Dark `#0B0F19` (sidebar). Tokens live in `src/app/globals.css` (`brand-*`, `accent-600`, `ink`). Use `<Logo on="light|dark" />` from `src/components/logo.tsx`; trimmed renders are in `public/brand/`, originals in `public/Logo/`. App icons are Next file conventions: `src/app/favicon.ico`, `icon.png`, `apple-icon.png` (regenerate from `public/Logo/` if the logo changes). Plain CRM look — no gradients or glow on UI elements.

### Setup assistant and Business profile

`/setup` is the setup chat (owners). The app asks the questions and shows answer buttons (`src/lib/setup/questions.ts`); button clicks are mapped in code (no model call, ~1 s); only typed answers go to the model (`OPENAI_CHAT_MODEL`, default `gpt-4.1-nano`, with a compact prompt). The campaign plan uses `OPENAI_MODEL` (`gpt-4.1-mini`). It collects the demand profile, AI call settings and creates a campaign plan. `/profile` shows and edits the same data with forms, and regenerates the plan. Every value the model extracts is validated in `src/lib/setup/draft.ts`; plan numbers are computed in `src/lib/setup/plan.ts`. Prompts and JSON schemas are in `src/lib/setup/prompts.ts` — bump the prompt version when changing them. AI calls use `store: false` and are logged per workspace in `usage_records`.

### Leads and landing pages (M2)

Every lead or call — from any source — goes through `ingestLead()` (`src/lib/leads/ingest.ts`) → `ingest_lead()` in Postgres. It normalizes phone/email, matches an existing customer by phone or email (under a per-workspace lock), ignores repeat deliveries of the same `source + external_id`, and writes `lead.received` / `customer.created` events. Only the service role can call it; callers must check permission first. Customer status and notes change only through `set_customer_status()` / `update_customer_notes()`, which log an event.

Landing pages (`/landing-pages`) are template + JSON content (`src/lib/landing/content.ts`), rendered by `src/components/landing/landing-page.tsx` both in the editor preview and publicly at `/p/{slug}`. Public submissions (`src/app/p/actions.ts`) store UTM/click IDs and a consent record; the consent text is versioned (`CONSENT_VERSION`).

### ZIP code data

`public.us_zip_codes` holds ~41k US ZIPs with city, state and coordinates, from [GeoNames](https://www.geonames.org) postal codes (CC BY 4.0 — keep the attribution). The CSV is in `supabase/seed/us_zip_codes.csv`; load it with `npm run db:seed:zips` after the migration (idempotent). The setup chat uses `zip_city_matches` / `zips_within` to turn "Miami, 20 miles" into a ZIP list — the AI never generates ZIP codes.

### Team invites

Owners invite from **Settings**. Until the email provider is set up, the owner copies the invite link and sends it themselves; automatic invite emails come with Resend. The link opens `/invite/<token>`, which works signed in or out and explains wrong-account, expired, used and cancelled cases. Invites also appear on `/onboarding` for anyone signed in with the invited (verified) email.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (webpack; Turbopack crashes on some Windows setups) |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Vitest. `tests/rls.test.ts` checks tenant isolation against the linked Supabase project (skipped without env) |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:push:https` | Same, through the Supabase Management API over HTTPS — use when a VPN blocks Postgres ports. Needs `SUPABASE_ACCESS_TOKEN` in `.env.local`. `-- --dry-run` lists pending migrations |
| `npm run db:seed:zips` | Load the US ZIP code table from `supabase/seed/us_zip_codes.csv` |
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
    (app)/                signed-in app: dashboard, setup, leads, settings, …
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
