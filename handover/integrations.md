# Integrations

## Endpoints the outside world calls

| Endpoint | Caller | Protection |
|---|---|---|
| `POST /api/voice/retell` | Retell (call started / ended / analyzed, text chats) | `x-retell-signature` HMAC with `RETELL_API_KEY`, 5-minute window |
| `POST /api/voice/inbound` | Retell (incoming call: which business, caller lookup) | Same signature |
| `POST /api/voice/tools/<name>` | Retell during a call (`check_availability`, `book_appointment`) | Same signature |
| `POST /api/intake/call` | Call-tracking provider | HMAC with `INTAKE_SIGNING_SECRET` |
| `POST /api/intake/google-lead/<account id>` | Google Ads lead form webhook | Per-account key (shown in Admin > Google Ads) |
| `POST /api/cron/calls` | Supabase `pg_cron` | `Authorization: Bearer CRON_SECRET` |
| `GET /api/cron/google-sync` | Vercel Cron | `Authorization: Bearer CRON_SECRET` |
| `/api/google/connect`, `/api/google/callback` | Admin's browser (Google sign-in) | Platform admins only + state cookie |

Every delivery is logged in `webhook_deliveries` (Admin > Integration health and Recent webhook deliveries).

## Retell AI (calls, numbers, texts)

- One Lead96 account; key in `RETELL_API_KEY`. Admin > AI voice creates and updates each business's AI caller (agent + LLM, and a text agent), buys numbers and assigns them, runs browser test calls.
- Phone numbers must be bought in Retell after its identity check (KYC, done). Each number is bound to the business's agent with inbound and webhook URLs on lead96.com.
- **Texting (US):** carriers require an A2P 10DLC registration **per contractor** (business profile, brand, campaign) in Retell's dashboard - there is no API. The owner fills in Settings > Texting; an admin files it from Admin > Texting (all fields and the campaign text ready to copy) and sets the status there. Cost per contractor: about $19 one-time, $20 per month per number, $0.01 per text; review about 2-3 weeks. Until approved, visit confirmations and reminders go by email.
- Costs per call are logged in `usage_records` and on each call.

## Resend (email)

- Domain lead96.com verified (DNS records on `send`, `rsend`, `resend._domainkey`).
- App emails (invites, visit emails, reminders, alerts) via the API with `RESEND_API_KEY`; each send has an idempotency key so retries never double-send.
- Sign-in emails (confirm, reset) go through Supabase's SMTP setting, also via Resend.
- Test addresses (`.invalid`, `.test`, `example.com`) are never emailed. `delivered@resend.dev` accepts mail for tests.

## Google Ads

- Agency model: Lead96 manager account **151-473-9298** under admin@lead96.com. Contractors' ad accounts are linked under it (link request from the manager, the contractor accepts), or Lead96 creates client accounts there.
- One Google sign-in (admin@lead96.com) is stored encrypted (Admin > Google Ads > Connect / Reconnect). Each ad account is assigned to its business there.
- **API access level** belongs to the Google Cloud project of the OAuth client (project **255729401612**), not to the developer token (since API v25). It is **Explorer** (2,880 operations a day on real accounts). Basic (15,000) needs brand verification of that project, in Cloud Console > APIs & Services > Google Ads API.
- Leads arrive in real time through the lead form webhook (per account URL + key) and are caught up daily by the sync, which also pulls spend per campaign per day.
- If the Cloud consent screen is in Testing mode, the stored sign-in expires after 7 days; publish the consent screen to avoid that.

## Meta (Facebook / Instagram)

- Planned the same way (Lead96 Business Manager + System User token). Waiting for Husam's credentials (`META_*`). Consent: our consent checkbox must be added to Meta lead forms before the AI calls those leads.

## OpenAI

- Setup chat (`OPENAI_CHAT_MODEL`, default `gpt-4.1-nano`) and campaign plan (`OPENAI_MODEL`, default `gpt-4.1-mini`). Structured outputs only; every value is validated in code; `store: false`; usage logged per business.
