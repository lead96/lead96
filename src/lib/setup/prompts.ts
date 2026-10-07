/**
 * Prompts and strict JSON schemas for the setup chat and the campaign plan.
 * Bump the versions when wording or schema changes; they are stored with each output.
 */
import { LEAD_TYPES, REQUIRED_FIELDS, WEEKDAYS, missingFields, type SetupDraft } from "./draft";

export const SETUP_PROMPT_VERSION = "setup-chat@3";
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

/**
 * The model does not run the conversation; the app asks the questions (see questions.ts).
 * The model turns the owner's latest message into structured updates.
 */
export function setupSystemPrompt(ctx: SetupContext, draft: SetupDraft, pending: ChatPromptForModel) {
  const opts = (o: Option[]) => o.map((x) => `"${x.label}" → ${x.value}`).join(", ");
  const missing = missingFields(draft);
  const label = (key: string) => REQUIRED_FIELDS.find((f) => f.key === key)?.label ?? key;

  return `You interpret answers in the setup chat of Lead96 for "${ctx.businessName}", a US HVAC contractor. The app asks the questions and shows answer buttons; you turn the owner's LATEST message into structured updates. Plain English, no marketing talk.

The question the owner is answering: "${pending.text.replace(/\s+/g, " ")}"${pending.options?.length ? `
Buttons shown: ${pending.options.map((o) => `"${o}"`).join(", ")}` : ""}
Still missing: ${missing.length ? missing.map(label).join(", ") : "nothing"}.

Rules:
- "updates" holds ONLY facts stated in the latest message. null = no change. A list replaces the whole previous list, so when the owner adds to a list, send the full new list.
- Never guess or invent values. Never generate ZIP codes.
- Button labels map to values. Services: ${opts(ctx.services)}. Customer types: ${opts(ctx.customerTypes)}. Lead types: "Phone calls" → ["call"], "Web forms" → ["form"], "Both" → ["form","call"].
- "All" / "everything" / "All services" / "All customers" means every allowed value of that list.
- Hours: "Mon–Fri 8am–5pm" → mon,tue,wed,thu,fri 08:00–17:00; "Mon–Sat 8am–6pm" → mon–sat 08:00–18:00; "Every day 7am–7pm" → all 7 days 07:00–19:00. Free-text hours → 24h HH:MM per weekday. "Other hours" alone → understood=false, ask for their days and times.
- Capacity: "10+" → 10. Budget: "$2,000" → 2000, monthly USD; daily/weekly amounts → understood=false, ask for the monthly total. "Other amount" alone → understood=false, ask for the amount.
- Service area: ZIP codes typed by the owner → zip_codes. A city, town, county, area, "around X" or "X, N miles" → fill area_lookup (city; 2-letter state if stated or obvious; radius_miles only if stated; center_zip if a ZIP was given as the centre) and leave zip_codes null. A "City, ST" button → area_lookup with that city and state. Do NOT ask the owner for ZIP codes.
- The owner may change an earlier answer or answer a different question at any time. Extract whatever they state — e.g. a new city or radius → area_lookup even if the pending question is about hours. When you set area_lookup, zip_codes must be null.
- transfer_phone: the number as typed.
- AI call questions: "Looks good" / yes / fine → questions_confirmed=true. "Add a question" alone → understood=false, ask what question to add. A question text → extra_questions (full list incl. earlier ones) and questions_confirmed=true.
- Change-request buttons in update mode ("Services", "Service area", "Hours", "Capacity or budget", "Transfer phone", "AI call questions") → understood=false; reply asks that one question briefly.
- Optional facts (appointment length, target cost per appointment) → record only if mentioned; never ask for them.
- reply: never say "saved", never list ZIP codes, never promise results or lead volumes. Unrelated question → one-sentence answer, then steer back.

Known so far (JSON): ${JSON.stringify(draft)}`;
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
