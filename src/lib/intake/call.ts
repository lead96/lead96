/**
 * Call intake payload (v1). Every phone call to a business - answered by the AI agent, a person,
 * voicemail or missed - becomes a lead of kind "call". The M3 voice service maps its provider's
 * events (Twilio etc.) to this shape and posts it, signed, to /api/intake/call.
 */
import { z } from "zod";
import type { RawLead } from "@/lib/leads/normalize";

const text = (max: number) => z.string().trim().max(max).nullish();

export const CALL_STATUSES = ["completed", "missed", "voicemail", "busy", "failed"] as const;

export const callPayloadSchema = z.object({
  call_id: z.string().trim().min(1).max(200),
  workspace_id: z.uuid(),
  from: text(40), // caller number; null when caller ID is blocked
  to: text(40), // the number that was dialed (tracking number)
  started_at: z.iso.datetime({ offset: true }),
  duration_seconds: z.number().int().min(0).max(86_400).default(0),
  status: z.enum(CALL_STATUSES).default("completed"),
  answered_by: z.enum(["ai", "human", "voicemail", "none"]).nullish(),
  transferred_to: text(40),
  caller_name: text(200),
  email: text(320),
  zip: text(20),
  service: text(100),
  summary: text(4000),
  recording_url: z.url({ protocol: /^https$/ }).max(1000).nullish(),
  /** What the tracking number was attached to, when known. */
  tracking: z
    .object({
      source: z.enum(["google", "meta", "landing_page", "website", "other"]).nullish(),
      landing_page_id: z.uuid().nullish(),
      campaign_id: text(100),
      campaign_name: text(300),
      adset_name: text(300),
      ad_name: text(300),
      keyword: text(300),
      utm_source: text(300),
      utm_medium: text(300),
      utm_campaign: text(300),
      gclid: text(300),
      fbclid: text(300),
    })
    .nullish(),
  /** Answers the AI agent collected (question key -> answer). */
  answers: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean()])).optional(),
});
export type CallPayload = z.infer<typeof callPayloadSchema>;

/** Call metadata kept in lead.fields; the customer page shows these as call details, not form answers. */
export const CALL_FIELD_KEYS = ["call_status", "duration_seconds", "answered_by", "dialed_number", "transferred_to", "recording_url"] as const;

export function callToLead(c: CallPayload): RawLead {
  const t = c.tracking ?? {};
  const source: RawLead["source"] = t.source && t.source !== "other" ? t.source : "call";
  const meta: Record<string, unknown> = {
    call_status: c.status,
    duration_seconds: c.duration_seconds,
    answered_by: c.answered_by ?? null,
    dialed_number: c.to ?? null,
    transferred_to: c.transferred_to ?? null,
    recording_url: c.recording_url ?? null,
  };
  return {
    workspace_id: c.workspace_id,
    kind: "call",
    source,
    external_id: `call_${c.call_id}`,
    landing_page_id: t.landing_page_id ?? null,
    campaign_id: t.campaign_id ?? null,
    campaign_name: t.campaign_name ?? null,
    adset_name: t.adset_name ?? null,
    ad_name: t.ad_name ?? null,
    keyword: t.keyword ?? null,
    utm_source: t.utm_source ?? null,
    utm_medium: t.utm_medium ?? null,
    utm_campaign: t.utm_campaign ?? null,
    gclid: t.gclid ?? null,
    fbclid: t.fbclid ?? null,
    full_name: c.caller_name ?? null,
    phone: c.from ?? null,
    email: c.email ?? null,
    zip: c.zip ?? null,
    service: c.service ?? null,
    message: c.summary ?? null,
    // Call metadata last, so an answer can never overwrite it.
    fields: { ...(c.answers ?? {}), ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== null)) },
    received_at: c.started_at,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
