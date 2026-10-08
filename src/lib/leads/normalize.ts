/**
 * Normalizes an incoming lead from any source (landing page, Meta, Google, CSV, manual, call)
 * into the shape ingest_lead() expects. Pure — unit-tested.
 */
import { normalizeUsPhone, parseZips } from "@/lib/setup/draft";

export const LEAD_SOURCES = ["landing_page", "meta", "google", "csv", "manual", "call", "website"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  landing_page: "Landing page",
  meta: "Facebook",
  google: "Google",
  csv: "CSV import",
  manual: "Manual",
  call: "Phone call",
  website: "Website",
};

export const CUSTOMER_STATUSES = ["new", "contacted", "qualified", "appointment", "showed", "estimate", "won", "lost"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const STATUS_LABELS: Record<CustomerStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment: "Appointment",
  showed: "Showed",
  estimate: "Estimate",
  won: "Won",
  lost: "Lost",
};

// Kept to the brand palette: blue = in progress, green = won, gray = not started / closed.
export const STATUS_TONES: Record<CustomerStatus, "slate" | "blue" | "green"> = {
  new: "blue",
  contacted: "slate",
  qualified: "blue",
  appointment: "blue",
  showed: "blue",
  estimate: "blue",
  won: "green",
  lost: "slate",
};

export type RawLead = {
  workspace_id: string;
  kind: "form" | "call";
  source: LeadSource;
  external_id?: string | null;
  landing_page_id?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  keyword?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  page_url?: string | null;
  referrer?: string | null;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  zip?: string | null;
  service?: string | null;
  message?: string | null;
  fields?: Record<string, unknown>;
  consent_given?: boolean;
  consent?: Record<string, unknown> | null;
  received_at?: string | null;
};

export type NormalizedLead = RawLead & { attribution_complete: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: string | null | undefined, max = 500) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

export function normalizeEmail(v: string | null | undefined): string | null {
  const e = (v ?? "").trim().toLowerCase();
  return EMAIL.test(e) && e.length <= 254 ? e : null;
}

/**
 * Source data is "complete" when we can tell which campaign/ad produced the lead.
 * Leads without it are still stored, but flagged — attribution is never invented.
 */
export function hasAttribution(l: RawLead): boolean {
  if (l.source === "meta" || l.source === "google") return Boolean(l.campaign_id || l.ad_id || l.form_id);
  return Boolean(l.utm_source || l.utm_campaign || l.gclid || l.fbclid || l.campaign_id || l.campaign_name);
}

export type NormalizeResult = { ok: true; lead: NormalizedLead } | { ok: false; error: string };

export function normalizeLead(raw: RawLead): NormalizeResult {
  if (!LEAD_SOURCES.includes(raw.source)) return { ok: false, error: `unknown source ${raw.source}` };
  const phone = raw.phone ? normalizeUsPhone(raw.phone) : null;
  const email = normalizeEmail(raw.email);
  // A lead nobody can contact is useless and can't be deduplicated.
  if (!phone && !email) return { ok: false, error: "A valid US phone number or email is required." };

  const lead: NormalizedLead = {
    ...raw,
    full_name: clean(raw.full_name, 120),
    phone,
    email,
    zip: raw.zip ? (parseZips(raw.zip)[0] ?? null) : null,
    service: clean(raw.service, 60),
    message: clean(raw.message, 2000),
    page_url: clean(raw.page_url, 1000),
    referrer: clean(raw.referrer, 1000),
    fields: raw.fields ?? {},
    consent_given: Boolean(raw.consent_given),
    attribution_complete: false,
  };
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const) {
    lead[k] = clean(raw[k], 300);
  }
  lead.attribution_complete = hasAttribution(lead);
  return { ok: true, lead };
}
