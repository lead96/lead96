import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { ingestLeads } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/server";
import { apiRowToLead, friendlyGoogleError, googleAdsError, microsToAmount, type ApiLeadRow } from "./leads";

/**
 * Google Ads, agency model: one sign-in (stored encrypted) with access to the Lead96 manager
 * account; every request goes through that manager account (login-customer-id).
 */

/** Short-lived cookie that ties the Google callback to the admin who started the sign-in. */
export const GOOGLE_STATE_COOKIE = "lg_google_state";
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords", "openid", "email"];
const TIMEOUT_MS = 20_000;

export class GoogleAdsError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const digits = (id: string) => id.replace(/\D/g, "");

export function googleConfig() {
  const env = serverEnv();
  const missing = [
    !env.GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID",
    !env.GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
    !env.GOOGLE_ADS_DEVELOPER_TOKEN && "GOOGLE_ADS_DEVELOPER_TOKEN",
    !env.GOOGLE_ADS_MANAGER_ID && "GOOGLE_ADS_MANAGER_ID",
    !env.CREDENTIALS_ENCRYPTION_KEY && "CREDENTIALS_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];
  return {
    missing,
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    managerId: digits(env.GOOGLE_ADS_MANAGER_ID ?? ""),
    apiVersion: env.GOOGLE_ADS_API_VERSION,
    encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY ?? "",
    redirectUri: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/google/callback`,
  };
}

// ---------------------------------------------------------------------------
// Sign-in (OAuth)
// ---------------------------------------------------------------------------

export function authUrl(state: string) {
  const c = googleConfig();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token, also on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Exchanges the sign-in code and stores the refresh token (encrypted). Returns the Google email. */
export async function completeSignIn(code: string, userId: string): Promise<string | null> {
  const c = googleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !body.refresh_token) {
    throw new GoogleAdsError(body.error ?? "NO_REFRESH_TOKEN", body.error_description ?? "Google did not return a refresh token.");
  }
  const scopes = (body.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(GOOGLE_SCOPES[0])) throw new GoogleAdsError("SCOPE_MISSING", "Google Ads access wasn't granted. Tick the Google Ads box on the consent screen.");
  const email = emailFromIdToken(body.id_token);

  const { error } = await createAdminClient()
    .from("platform_connections")
    .upsert({
      provider: "google_ads",
      account_email: email,
      secret_ciphertext: encryptSecret(body.refresh_token, c.encryptionKey),
      scopes,
      connected_by: userId,
      connected_at: new Date().toISOString(),
      last_ok_at: null,
      last_error: null,
      last_error_at: null,
    });
  if (error) throw new GoogleAdsError("STORE_FAILED", error.message);
  accessToken = null;
  return email;
}

function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export type GoogleConnection = { account_email: string | null; connected_at: string; last_ok_at: string | null; last_error: string | null; last_error_at: string | null };

export async function getConnection(): Promise<GoogleConnection | null> {
  const { data } = await createAdminClient()
    .from("platform_connections")
    .select("account_email, connected_at, last_ok_at, last_error, last_error_at")
    .eq("provider", "google_ads")
    .maybeSingle();
  return data;
}

export async function disconnect() {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_connections").select("secret_ciphertext").eq("provider", "google_ads").maybeSingle();
  if (data) {
    // Best effort: also revoke the token at Google.
    try {
      const token = decryptSecret(data.secret_ciphertext, googleConfig().encryptionKey);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {}
  }
  await admin.from("platform_connections").delete().eq("provider", "google_ads");
  accessToken = null;
}

let accessToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.token;
  const c = googleConfig();
  if (c.missing.length) throw new GoogleAdsError("NOT_CONFIGURED", `Missing: ${c.missing.join(", ")}`);
  const { data } = await createAdminClient().from("platform_connections").select("secret_ciphertext").eq("provider", "google_ads").maybeSingle();
  if (!data) throw new GoogleAdsError("NOT_CONNECTED", "Google Ads isn't connected yet.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: decryptSecret(data.secret_ciphertext, c.encryptionKey),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    const e =
      body.error === "invalid_grant"
        ? new GoogleAdsError("SIGN_IN_EXPIRED", "The Google sign-in expired or was revoked. Reconnect Google Ads. (While the consent screen is in Testing mode, sign-ins last 7 days.)")
        : new GoogleAdsError(body.error ?? `HTTP_${res.status}`, "Google refused the stored sign-in.");
    await recordConnectionResult(e.message);
    throw e;
  }
  accessToken = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return accessToken.token;
}

async function recordConnectionResult(error: string | null) {
  const now = new Date().toISOString();
  await createAdminClient()
    .from("platform_connections")
    .update(error ? { last_error: error.slice(0, 1000), last_error_at: now } : { last_ok_at: now, last_error: null })
    .eq("provider", "google_ads");
}

// ---------------------------------------------------------------------------
// Queries (GAQL over REST)
// ---------------------------------------------------------------------------

/** Runs a GAQL query against one account (through the manager account) and returns all rows. */
export async function search<T>(customerId: string, query: string): Promise<T[]> {
  const c = googleConfig();
  const token = await getAccessToken();
  const rows: T[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`https://googleads.googleapis.com/${c.apiVersion}/customers/${digits(customerId)}/googleAds:search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "developer-token": c.developerToken,
        "login-customer-id": c.managerId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { results?: T[]; nextPageToken?: string };
    if (!res.ok) {
      const e = googleAdsError(body, res.status);
      const err = new GoogleAdsError(e.code, friendlyGoogleError(e));
      await recordConnectionResult(err.message);
      throw err;
    }
    rows.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  await recordConnectionResult(null);
  return rows;
}

export type ClientAccount = { id: string; name: string; currency: string | null; timeZone: string | null; test: boolean; status: string | null };

/** Ad accounts directly under the manager account (not sub-managers). */
export async function listClientAccounts(): Promise<ClientAccount[]> {
  type Row = { customerClient: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; testAccount?: boolean; manager?: boolean; status?: string } };
  const rows = await search<Row>(
    googleConfig().managerId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone,
            customer_client.test_account, customer_client.manager, customer_client.status
     FROM customer_client WHERE customer_client.level = 1`,
  );
  return rows
    .map((r) => r.customerClient)
    .filter((cc) => cc.id && !cc.manager)
    .map((cc) => ({ id: String(cc.id), name: cc.descriptiveName || `Account ${cc.id}`, currency: cc.currencyCode ?? null, timeZone: cc.timeZone ?? null, test: Boolean(cc.testAccount), status: cc.status ?? null }));
}

/** Campaign and ad group names for one ad group (used to name webhook leads). */
export async function adGroupNames(customerId: string, adGroupId: string) {
  type Row = { campaign?: { name?: string }; adGroup?: { name?: string } };
  const [row] = await search<Row>(customerId, `SELECT campaign.name, ad_group.name FROM ad_group WHERE ad_group.id = ${digits(adGroupId)} LIMIT 1`);
  return { campaign: row?.campaign?.name ?? null, adGroup: row?.adGroup?.name ?? null };
}

// ---------------------------------------------------------------------------
// Sync: leads (catch-up for the webhook) + daily spend
// ---------------------------------------------------------------------------

export type SyncSummary = { leadsFound: number; leadsNew: number; leadsKnown: number; leadsFailed: number; spendRows: number; spendTotal: number; days: number };

type Account = { id: string; workspace_id: string; external_id: string; currency: string | null; last_sync_at: string | null };

export async function syncAccount(account: Account, days = 30): Promise<SyncSummary> {
  const admin = createAdminClient();
  try {
    const summary = { ...(await syncLeads(account, days)), ...(await syncSpend(account, days)), days };
    await admin
      .from("ad_accounts")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null, last_sync_summary: summary })
      .eq("id", account.id);
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("ad_accounts").update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: message.slice(0, 1000) }).eq("id", account.id);
    throw e;
  }
}

async function syncLeads(account: Account, days: number) {
  type NameRow = { campaign?: { id?: string; name?: string }; adGroup?: { id?: string; name?: string } };
  const [leads, campaignRows, adGroupRows] = await Promise.all([
    search<ApiLeadRow>(
      account.external_id,
      `SELECT lead_form_submission_data.id, lead_form_submission_data.gclid, lead_form_submission_data.submission_date_time,
              lead_form_submission_data.campaign, lead_form_submission_data.ad_group, lead_form_submission_data.ad_group_ad,
              lead_form_submission_data.asset, lead_form_submission_data.lead_form_submission_fields,
              lead_form_submission_data.custom_lead_form_submission_fields
       FROM lead_form_submission_data`,
    ),
    search<NameRow>(account.external_id, `SELECT campaign.id, campaign.name FROM campaign`),
    search<NameRow>(account.external_id, `SELECT ad_group.id, ad_group.name FROM ad_group`),
  ]);
  const names = {
    campaigns: new Map(campaignRows.map((r) => [String(r.campaign?.id), r.campaign?.name ?? ""])),
    adGroups: new Map(adGroupRows.map((r) => [String(r.adGroup?.id), r.adGroup?.name ?? ""])),
  };
  const since = Date.now() - days * 86_400_000;
  const raws = leads.map((row) => apiRowToLead(row, account.workspace_id, names)).filter((l) => !l.received_at || Date.parse(l.received_at) >= since);

  let leadsNew = 0;
  let leadsKnown = 0;
  let leadsFailed = 0;
  for (let i = 0; i < raws.length; i += 200) {
    for (const r of await ingestLeads(raws.slice(i, i + 200))) {
      if (!r.ok) leadsFailed++;
      else if (r.duplicate) leadsKnown++;
      else leadsNew++;
    }
  }
  return { leadsFound: raws.length, leadsNew, leadsKnown, leadsFailed };
}

async function syncSpend(account: Account, days: number) {
  type Row = { campaign?: { id?: string; name?: string }; segments?: { date?: string }; metrics?: { costMicros?: string; clicks?: string; impressions?: string; conversions?: number } };
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const from = new Date(today.getTime() - days * 86_400_000);
  const rows = await search<Row>(
    account.external_id,
    `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
     FROM campaign WHERE segments.date BETWEEN '${fmt(from)}' AND '${fmt(today)}'`,
  );
  const records = rows
    .filter((r) => r.campaign?.id && r.segments?.date)
    .map((r) => ({
      workspace_id: account.workspace_id,
      platform: "google",
      account_external_id: account.external_id,
      campaign_id: String(r.campaign!.id),
      campaign_name: r.campaign!.name ?? null,
      date: r.segments!.date!,
      cost: microsToAmount(r.metrics?.costMicros),
      currency: account.currency,
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      updated_at: new Date().toISOString(),
    }));
  if (records.length) {
    const { error } = await createAdminClient().from("ad_spend_daily").upsert(records, { onConflict: "platform,account_external_id,campaign_id,date" });
    if (error) throw new GoogleAdsError("STORE_FAILED", `Could not save spend: ${error.message}`);
  }
  return { spendRows: records.length, spendTotal: Math.round(records.reduce((s, r) => s + r.cost, 0) * 100) / 100 };
}
