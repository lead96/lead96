# Lead96 handover

Operating manual for Lead96: what runs where, how to deploy, what to do when something breaks, and how data is protected. For code-level detail (each module, how it works inside) see the main [README](../README.md).

Written 2026-10-16 (end of M6 build). Keep it updated when accounts, settings or procedures change.

| Document | For |
|---|---|
| [Architecture](architecture.md) | What the system is made of and how a lead flows through it |
| [Environments and secrets](environments-and-secrets.md) | Every account, setting and secret, and where it lives |
| [Deploy](deploy.md) | Shipping code and database changes, CI, rolling back |
| [Database](database.md) | Data model, access rules, scheduled jobs |
| [Integrations](integrations.md) | Retell, Resend, Google Ads, Meta, OpenAI: setup and endpoints |
| [Operations](operations.md) | Runbooks: alerts, failures, onboarding a business, lost 2FA, secrets |
| [Backup and restore](backup-restore.md) | What is backed up today, what is not, how to restore |

## The system in one minute

- **App:** Next.js 16 on **Vercel**, domain **lead96.com**. Code on GitHub (`lead96/lead96`, account admin@lead96.com).
- **Data:** **Supabase** project "Lead96" (`jrtbcaxxqiondfpyghey`, US East): Postgres database, sign-in, file storage. Today the same project serves development and production.
- **AI calls and texts:** **Retell AI** (voice agents, phone numbers, SMS).
- **Email:** **Resend** (app emails through the API; sign-in emails through Supabase SMTP), sending from lead96.com.
- **Ads:** **Google Ads** through the Lead96 manager account 151-473-9298; **Meta** waiting for credentials.
- **AI text:** **OpenAI** (setup chat, campaign plan).
- **Background work:** Postgres `pg_cron` wakes the app every minute when calls, messages or alerts are due; Vercel Cron runs the daily Google Ads sync.

## Owners and access (to complete before the pilot)

Every account should have Husam (Halawa GmbH) as owner and Riku as admin, and every password / key should live in one shared password manager, not in chats.

"Check" = not confirmed at the time of writing; fill in when verified.

| System | Account today | To do |
|---|---|---|
| GitHub `lead96/lead96` | admin@lead96.com | Riku as admin |
| Vercel (lead96.com) | check | Owned by admin@lead96.com (or Husam as owner), Riku as member |
| Supabase "Lead96" | admin@lead96.com | Riku as Developer or Owner |
| Retell AI | Lead96 account (identity check done by Husam) | Check both have access |
| Resend (lead96.com domain) | check | Both have access |
| Google Cloud project 255729401612 (display name "Laed96") | check | Husam owner, Riku editor |
| Google Ads manager 151-473-9298 | admin@lead96.com | Riku as admin user |
| GoDaddy (DNS for lead96.com) | Husam | Riku as delegate |
| Google Workspace (admin@lead96.com mail) | Husam | - |

## Open items at handover

1. **Backups:** the Supabase free plan keeps none. Upgrade to Pro and test a restore ([Backup and restore](backup-restore.md)). Until then run `npm run db:export` regularly.
2. **Separate production database** from development.
3. **Outside monitoring** (Sentry or an uptime check): the failure alert emails can't report the app itself being down.
4. **Meta** credentials, **US texting registration** per contractor, **legal review** of consent and the legal pages.
