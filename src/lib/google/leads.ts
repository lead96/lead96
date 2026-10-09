/**
 * Google Ads lead forms -> our lead shape. Two ways in, one mapping:
 *  - the lead-form webhook (real time, set per form in Google Ads)
 *  - the API (lead_form_submission_data), used to catch up on anything the webhook missed.
 * When Google gives a click ID, both use it as the lead's id, so the same lead from both ways is stored once.
 * Pure - unit-tested.
 */
import { z } from "zod";
import type { RawLead } from "@/lib/leads/normalize";

const id = z.union([z.string(), z.number()]).transform(String);

/** Webhook body (Google Ads lead form webhook, api_version 1.0). */
export const googleWebhookSchema = z.object({
  lead_id: z.string().min(1).max(500),
  google_key: z.string().max(500).optional(),
  api_version: z.string().optional(),
  form_id: id.optional(),
  campaign_id: id.optional(),
  adgroup_id: id.optional(),
  creative_id: id.optional(),
  asset_group_id: id.optional(),
  gcl_id: z.string().max(500).optional(),
  is_test: z.boolean().optional(),
  lead_submit_time: z.string().optional(),
  lead_source: z.string().optional(),
  user_column_data: z
    .array(z.object({ column_id: z.string().max(200).optional(), column_name: z.string().max(300).optional(), string_value: z.string().max(2000).optional() }))
    .max(100)
    .default([]),
});
export type GoogleWebhookLead = z.infer<typeof googleWebhookSchema>;

/** Standard question types (LeadFormFieldUserInputType) we map to lead fields; the rest are kept as answers. */
type Contact = { full_name?: string; first?: string; last?: string; phone?: string; email?: string; zip?: string };
const STANDARD: Record<string, keyof Contact | "address" | "city"> = {
  FULL_NAME: "full_name",
  FIRST_NAME: "first",
  LAST_NAME: "last",
  PHONE_NUMBER: "phone",
  WORK_PHONE: "phone",
  EMAIL: "email",
  WORK_EMAIL: "email",
  POSTAL_CODE: "zip",
  STREET_ADDRESS: "address",
  CITY: "city",
};

const answerKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "answer";

function collect(entries: { type?: string; label?: string; value?: string }[]) {
  const contact: Contact = {};
  const fields: Record<string, string> = {};
  for (const e of entries) {
    const value = (e.value ?? "").trim();
    if (!value) continue;
    const target = e.type ? STANDARD[e.type] : undefined;
    if (target === "address" || target === "city") fields[target] = value;
    else if (target) contact[target] ??= value;
    else fields[answerKey(e.label ?? e.type ?? "answer")] = value.slice(0, 500);
  }
  const full_name = contact.full_name ?? ([contact.first, contact.last].filter(Boolean).join(" ") || undefined);
  return { full_name, phone: contact.phone, email: contact.email, zip: contact.zip, fields };
}

/** Our lead id for a Google lead: the click ID when Google gives one (same from webhook and API). */
export function googleExternalId(gclid: string | null | undefined, fallback: string) {
  return gclid ? `gclid:${gclid}` : fallback;
}

export function webhookToLead(w: GoogleWebhookLead, workspaceId: string): RawLead {
  const c = collect(w.user_column_data.map((u) => ({ type: u.column_id, label: u.column_name, value: u.string_value })));
  return {
    workspace_id: workspaceId,
    kind: "form",
    source: "google",
    external_id: googleExternalId(w.gcl_id, `lead:${w.lead_id}`),
    campaign_id: w.campaign_id ?? null,
    adset_id: w.adgroup_id ?? w.asset_group_id ?? null,
    ad_id: w.creative_id ?? null,
    form_id: w.form_id ?? null,
    gclid: w.gcl_id ?? null,
    full_name: c.full_name ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    zip: c.zip ?? null,
    fields: c.fields,
    // Google's form shows the advertiser's privacy policy, not our call/SMS consent text.
    consent_given: false,
    consent: { source: "google_lead_form", note: "Privacy policy accepted on Google's form; no AI-call consent text shown." },
    received_at: parseGoogleTime(w.lead_submit_time),
  };
}

/** One row of `SELECT lead_form_submission_data.* FROM lead_form_submission_data` (REST JSON, camelCase). */
export type ApiLeadRow = {
  leadFormSubmissionData: {
    id?: string;
    campaign?: string;
    adGroup?: string;
    adGroupAd?: string;
    asset?: string;
    gclid?: string;
    submissionDateTime?: string;
    leadFormSubmissionFields?: { fieldType?: string; fieldValue?: string }[];
    customLeadFormSubmissionFields?: { questionText?: string; fieldValue?: string }[];
  };
};

/** Last path segment of a resource name; for adGroupAds (".../adGroupAds/111~222") the ad ID. */
export const resourceId = (name?: string) => {
  const last = name?.split("/").pop();
  return last ? (last.split("~").pop() ?? null) : null;
};

export function apiRowToLead(
  row: ApiLeadRow,
  workspaceId: string,
  names: { campaigns: Map<string, string>; adGroups: Map<string, string> },
): RawLead {
  const d = row.leadFormSubmissionData;
  const c = collect([
    ...(d.leadFormSubmissionFields ?? []).map((f) => ({ type: f.fieldType, label: f.fieldType, value: f.fieldValue })),
    ...(d.customLeadFormSubmissionFields ?? []).map((f) => ({ label: f.questionText, value: f.fieldValue })),
  ]);
  const campaignId = resourceId(d.campaign);
  const adGroupId = resourceId(d.adGroup);
  return {
    workspace_id: workspaceId,
    kind: "form",
    source: "google",
    external_id: googleExternalId(d.gclid, `submission:${d.id}`),
    campaign_id: campaignId,
    campaign_name: campaignId ? (names.campaigns.get(campaignId) ?? null) : null,
    adset_id: adGroupId,
    adset_name: adGroupId ? (names.adGroups.get(adGroupId) ?? null) : null,
    ad_id: resourceId(d.adGroupAd),
    form_id: resourceId(d.asset),
    gclid: d.gclid ?? null,
    full_name: c.full_name ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    zip: c.zip ?? null,
    fields: c.fields,
    consent_given: false,
    consent: { source: "google_lead_form", note: "Privacy policy accepted on Google's form; no AI-call consent text shown." },
    received_at: parseGoogleTime(d.submissionDateTime),
  };
}

/** "2019-01-01 12:32:45-08:00" (API) or ISO-8601 (webhook) -> ISO UTC; null if unreadable. */
export function parseGoogleTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const t = Date.parse(value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Google Ads money is in micros (1,000,000 = 1 unit of the account currency). */
export const microsToAmount = (micros: string | number | undefined) => Math.round(Number(micros ?? 0) / 10_000) / 100;

/** First readable error from a Google Ads API error body. */
export function googleAdsError(body: unknown, status: number): { code: string; message: string } {
  const b = body as {
    error?: { message?: string; status?: string; details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[] };
  };
  const detail = b?.error?.details?.flatMap((d) => d.errors ?? [])[0];
  const code = detail?.errorCode ? Object.values(detail.errorCode)[0] : (b?.error?.status ?? `HTTP_${status}`);
  return { code, message: detail?.message ?? b?.error?.message ?? `Google Ads API answered ${status}` };
}

const FRIENDLY: Record<string, string> = {
  DEVELOPER_TOKEN_NOT_APPROVED:
    "The developer token only has Test access, so it can't read real accounts. Use a test manager account, or apply for Basic access in API Center.",
  CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION:
    "Google Ads API access is still at Test level, so only test accounts can be read. Use a test manager account for now, or apply for Explorer/Basic access in API Center.",
  DEVELOPER_TOKEN_PROHIBITED: "This developer token can't be used with this Google Cloud project.",
  USER_PERMISSION_DENIED: "The connected Google user has no access to this account through the manager account.",
  CUSTOMER_NOT_ENABLED: "This Google Ads account isn't active (cancelled or never finished setup).",
  NOT_ADS_USER: "The connected Google user has no Google Ads access. Reconnect with the user that manages the manager account.",
  OAUTH_TOKEN_REVOKED: "The Google sign-in was revoked. Reconnect Google Ads.",
  OAUTH_TOKEN_EXPIRED: "The Google sign-in expired. Reconnect Google Ads.",
};
export const friendlyGoogleError = (e: { code: string; message: string }) => FRIENDLY[e.code] ?? `${e.code}: ${e.message}`;
