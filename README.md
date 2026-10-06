# LeadGen OS

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

For each hosted project (dev, staging, prod): Supabase → Authentication → Emails, paste the HTML from `supabase/templates/` into the matching template:

| Template | File |
|---|---|
| Confirm signup | `confirmation.html` |
| Reset Password | `recovery.html` |
| Magic Link | `magic_link.html` |
| Change Email Address | `email_change.html` |

`{{ .SiteURL }}` in the templates is the project's Site URL, so it must be the app URL for that environment. `supabase/config.toml` points to the same files for local Supabase.

Supabase's built-in email sender only delivers to the project's team members and a few emails per hour. Before real users sign up, configure custom SMTP (Resend) under Authentication → SMTP.

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
