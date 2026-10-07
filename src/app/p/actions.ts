"use server";

import { headers } from "next/headers";
import { CONSENT_VERSION, consentText, readContent, defaultContent, type TemplateKey } from "@/lib/landing/content";
import { ingestLead } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/server";

export type SubmitState = { ok?: boolean; error?: string; fields?: Record<string, string> } | undefined;

const MIN_FILL_MS = 2500; // bots submit instantly
const f = (d: FormData, k: string, max = 300) => String(d.get(k) ?? "").trim().slice(0, max);

/**
 * Public form submission from a published landing page. Anyone can call this, so it only
 * trusts the page id (must be published) and treats everything else as untrusted input.
 */
export async function submitLandingForm(_: SubmitState, data: FormData): Promise<SubmitState> {
  const fields = Object.fromEntries(["full_name", "phone", "email", "zip", "service", "message"].map((k) => [k, f(data, k, 2000)]));

  // Spam checks: hidden honeypot field filled, or the form was submitted implausibly fast.
  const startedAt = Number(f(data, "started_at"));
  if (f(data, "company_website") || !startedAt || Date.now() - startedAt < MIN_FILL_MS) {
    return { ok: true }; // look successful to bots, store nothing
  }
  if (data.get("consent") !== "yes") return { error: "Please tick the box to agree to be contacted.", fields };

  const admin = createAdminClient();
  const { data: page } = await admin
    .from("landing_pages")
    .select("id, workspace_id, template, content, status, name")
    .eq("id", f(data, "page_id", 40))
    .maybeSingle();
  if (!page || page.status !== "published") return { error: "This page is no longer accepting requests.", fields };
  const content = readContent(page.content, defaultContent(page.template as TemplateKey, { businessName: page.name }));

  // Quiz / extra answers are kept verbatim next to the standard fields.
  const answers: Record<string, string> = {};
  for (const k of ["urgency", "homeowner", "system_age"]) if (f(data, k)) answers[k] = f(data, k, 100);

  const h = await headers();
  const result = await ingestLead({
    workspace_id: page.workspace_id,
    kind: "form",
    source: "landing_page",
    landing_page_id: page.id,
    full_name: fields.full_name,
    phone: fields.phone,
    email: fields.email,
    zip: fields.zip,
    service: fields.service || null,
    message: fields.message,
    fields: { ...answers, ...(fields.service ? { service: fields.service } : {}) },
    utm_source: f(data, "utm_source"),
    utm_medium: f(data, "utm_medium"),
    utm_campaign: f(data, "utm_campaign"),
    utm_content: f(data, "utm_content"),
    utm_term: f(data, "utm_term"),
    gclid: f(data, "gclid"),
    fbclid: f(data, "fbclid"),
    page_url: f(data, "page_url", 1000),
    referrer: f(data, "referrer", 1000),
    consent_given: true,
    consent: {
      text: consentText(content.business_name),
      version: CONSENT_VERSION,
      at: new Date().toISOString(),
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 300),
    },
  });
  if (!result.ok) return { error: result.error, fields };
  return { ok: true };
}
