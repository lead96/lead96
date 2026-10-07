/**
 * Prompts and strict JSON schemas for the setup chat and the campaign plan.
 * Bump the versions when wording or schema changes; they are stored with each output.
 */
import { LEAD_TYPES, WEEKDAYS, describeHours, type SetupDraft } from "./draft";

export const SETUP_PROMPT_VERSION = "setup-chat@5";
export const PLAN_PROMPT_VERSION = "campaign-plan@1";

export type Option = { value: string; label: string };
export type SetupContext = {
  businessName: string;
  services: Option[];
  customerTypes: Option[];
  defaultQuestions: string[];
};

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const list = (items: object) => nullable({ type: "array", items });

export function setupTurnSchema(ctx: SetupContext) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reply", "understood", "updates", "area_lookup"],
    properties: {
      reply: {
        type: "string",
        description:
          "If understood: a 3–10 word acknowledgement of what you took from the message. If not understood: one short clarifying question or a one-sentence answer (≤ 30 words).",
      },
      understood: {
        type: "boolean",
        description: "true if the owner's latest message answered the pending question or gave other setup facts.",
      },
      updates: {
        type: "object",
        additionalProperties: false,
        description: "Only what the owner just told you. null = no change. Lists replace the whole previous list.",
        required: [
          "services", "lead_types", "customer_types", "zip_codes", "booking_hours", "capacity_per_day",
          "appointment_minutes", "monthly_budget", "target_cost_per_appointment", "transfer_phone",
          "extra_questions", "questions_confirmed", "notes",
        ],
        properties: {
          services: list({ type: "string", enum: ctx.services.map((s) => s.value) }),
          lead_types: list({ type: "string", enum: [...LEAD_TYPES] }),
          customer_types: list({ type: "string", enum: ctx.customerTypes.map((s) => s.value) }),
          zip_codes: list({ type: "string" }),
          booking_hours: list({
            type: "object",
            additionalProperties: false,
            required: ["day", "start", "end"],
            properties: {
              day: { type: "string", enum: [...WEEKDAYS] },
              start: { type: "string", description: "24h HH:MM" },
              end: { type: "string", description: "24h HH:MM" },
            },
          }),
          capacity_per_day: nullable({ type: "integer" }),
          appointment_minutes: nullable({ type: "integer" }),
          monthly_budget: nullable({ type: "number" }),
          target_cost_per_appointment: nullable({ type: "number" }),
          transfer_phone: nullable({ type: "string" }),
          extra_questions: list({ type: "string" }),
          questions_confirmed: nullable({ type: "boolean" }),
          notes: nullable({ type: "string" }),
        },
      },
      area_lookup: nullable({
        type: "object",
        additionalProperties: false,
        description: "Set when the owner describes their service area by place instead of ZIP codes. The app looks up the ZIPs.",
        required: ["city", "state", "center_zip", "radius_miles"],
        properties: {
          city: nullable({ type: "string" }),
          state: nullable({ type: "string", description: "2-letter US state code, if known or stated" }),
          center_zip: nullable({ type: "string", description: "A ZIP the owner gave as the centre of their area" }),
          radius_miles: nullable({ type: "number", description: "Travel radius in miles, only if stated" }),
        },
      }),
    },
  } as const;
}

export type ChatPromptForModel = { text: string; options?: string[] };

/** What we know so far, compact: empty fields dropped, ZIP list reduced to a count. */
export function compactDraft(d: SetupDraft) {
  const out: Record<string, unknown> = {};
  if (d.services.length) out.services = d.services;
  if (d.lead_types.length) out.lead_types = d.lead_types;
  if (d.customer_types.length) out.customer_types = d.customer_types;
  if (d.zip_codes.length) out.service_area = d.area_description ?? `${d.zip_codes.length} ZIP codes`;
  if (Object.keys(d.booking_hours).length) out.hours = describeHours(d.booking_hours);
  if (d.capacity_per_day !== null) out.capacity_per_day = d.capacity_per_day;
  if (d.monthly_budget !== null) out.monthly_budget = d.monthly_budget;
  if (d.transfer_phone) out.transfer_phone = d.transfer_phone;
  if (d.extra_questions.length) out.extra_questions = d.extra_questions;
  return out;
}

/**
 * The model does not run the conversation; the app asks the questions and maps button
 * clicks itself (see questions.ts). The model only interprets typed answers.
 */
export function setupSystemPrompt(ctx: SetupContext, draft: SetupDraft, pending: ChatPromptForModel) {
  const opts = (o: Option[]) => o.map((x) => `${x.value} (${x.label})`).join(", ");
  return `Turn the owner's latest typed message into structured updates for the setup of "${ctx.businessName}", a US HVAC contractor.
Pending question: "${pending.text.replace(/\s+/g, " ").slice(0, 200)}"

Rules:
- updates = only facts in the latest message; null = no change; never invent values or ZIP codes. A list replaces the old list, so send the full new list (known values below).
- services: ${opts(ctx.services)}. customer_types: ${opts(ctx.customerTypes)}. lead_types: call, form. "All"/"everything" = every value of that list.
- Hours → 24h HH:MM per weekday. Budget = monthly USD; a daily/weekly amount → understood=false and ask for the monthly total.
- A place instead of ZIPs (city, area, "around X", "X, 20 miles") → area_lookup (city; 2-letter state if stated or obvious; radius_miles only if stated; center_zip if a ZIP is the centre) and zip_codes null. Typed ZIP codes → zip_codes.
- The owner may answer a different question or change an earlier answer — extract whatever they state.
- A new call question → extra_questions (full list) and questions_confirmed=true. "Fine"/"looks good" about the questions → questions_confirmed=true.
- Optional facts (appointment length, target cost per appointment) only if mentioned.
- area_lookup only when the LATEST message names a place; otherwise null.
- reply: if understood, "OK"; otherwise one short clarifying question (≤ 25 words). Never say "saved", never list ZIP codes, never promise results.

Known: ${JSON.stringify(compactDraft(draft))}`;
}

// ---------------------------------------------------------------------------
// Campaign plan
// ---------------------------------------------------------------------------

export const PLAN_CHANNELS = [
  { value: "google_search", label: "Google Search ads" },
  { value: "google_call_ads", label: "Google call ads" },
  { value: "meta_lead_ads", label: "Facebook & Instagram lead forms" },
] as const;

export const LANDING_TEMPLATES = [
  { value: "call_first", label: "Call-first page" },
  { value: "quote_form_call", label: "Quote form + call" },
  { value: "multi_step_quiz", label: "Multi-step quiz" },
  { value: "seasonal_offer", label: "Seasonal offer" },
] as const;

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "channels", "landing_page_template", "template_reason", "targeting_notes", "first_steps"],
  properties: {
    summary: { type: "string", description: "2–4 plain-English sentences for the owner." },
    channels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "share_percent", "reason"],
        properties: {
          channel: { type: "string", enum: PLAN_CHANNELS.map((c) => c.value) },
          share_percent: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
    landing_page_template: { type: "string", enum: LANDING_TEMPLATES.map((t) => t.value) },
    template_reason: { type: "string" },
    targeting_notes: { type: "string" },
    first_steps: { type: "array", items: { type: "string" } },
  },
} as const;

export function planSystemPrompt() {
  return `You are a senior performance marketer for US home-service contractors. Write a starting campaign plan for an HVAC business from its setup data.
Rules:
- Recommend a budget split across the allowed channels (share_percent sums to 100). Use 1–3 channels; small budgets (< $1,500/month) should focus on 1–2.
- If the business only wants phone calls, favour call-focused options and a call-first landing page. If it wants forms only, avoid call ads.
- Choose one landing page template and say why in one sentence.
- Plain English for a contractor with no ads experience. No jargon, no guarantees, no lead-volume or cost predictions.
- targeting_notes: 1–2 sentences about who and where to target (use the given service area, do not invent ZIP codes).
- first_steps: 3–5 short actions the owner takes next in Lead96 (e.g. connect Google Ads, review landing page).
- This is a recommendation only; nothing is launched automatically.`;
}
