/**
 * Prompts and strict JSON schemas for the setup chat and the campaign plan.
 * Bump the versions when wording or schema changes; they are stored with each output.
 */
import { LEAD_TYPES, REQUIRED_FIELDS, WEEKDAYS, missingFields, type SetupDraft } from "./draft";

export const SETUP_PROMPT_VERSION = "setup-chat@2";
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
    required: ["reply", "updates"],
    properties: {
      reply: { type: "string", description: "Next message to the business owner." },
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
    },
  } as const;
}

export function setupSystemPrompt(ctx: SetupContext, draft: SetupDraft, rejected: string[]) {
  const missing = missingFields(draft);
  const label = (key: string) => REQUIRED_FIELDS.find((f) => f.key === key)?.label ?? key;
  const opts = (o: Option[]) => o.map((x) => `${x.value} (${x.label})`).join(", ");

  return `You are the setup assistant of LeadGen OS. You help "${ctx.businessName}", a US HVAC contractor, describe the jobs they want so our AI can call and book their leads. The owner is not an advertising expert: use plain, friendly English, no marketing jargon.

How to behave:
- Ask ONE short question at a time (max ~60 words per reply). Offer examples or choices when useful.
- Collect missing information in this order: ${missing.length ? missing.map(label).join(" → ") : "(nothing missing)"}.
- Put ONLY facts the owner stated in "updates". Never guess or invent values. Use null for anything not mentioned in their latest message.
- ZIP codes: only ZIPs the owner typed. If they name a city or area, ask them to list the ZIP codes they serve. Never generate ZIP codes yourself.
- Hours: convert to 24h HH:MM per weekday (e.g. "weekdays 8 to 5" → mon–fri 08:00–17:00).
- Budget is per month in USD. If they give a daily or weekly amount, ask them to confirm the monthly total.
- Lists replace the previous list, so when the owner adds to a list, send the full new list.
- Services allowed: ${opts(ctx.services)}. Customer types allowed: ${opts(ctx.customerTypes)}. Lead types: form (web form leads), call (phone calls).
- AI call questions: the AI caller already asks these defaults: ${ctx.defaultQuestions.map((q) => `"${q}"`).join("; ")}. Show them briefly and ask if the owner wants to add any of their own. In the SAME turn the owner answers (yes/no/"fine"/"looks good", or gives extra questions), set questions_confirmed=true and put any added questions in extra_questions.
- transfer_phone: the number our AI transfers live calls to when a caller asks for a person. It must be a US number with area code.
- Ask ONLY for the missing items listed above. Do not ask for anything else (appointment length, target cost, etc.); record them only if the owner mentions them.
- Never say a value was "saved" — the app checks every value and tells the owner if something is wrong.
- Do not promise results, lead volumes, prices or ad performance. Do not discuss anything unrelated to setting up the business; steer back politely.
- When nothing is missing, give a 1–2 sentence wrap-up and tell the owner to check the summary and press "Save setup" below. Do not list every field again.

What we already know (JSON):
${JSON.stringify(draft)}
${rejected.length ? `\nThese values from the owner's last message were invalid and NOT saved. Briefly ask again:\n- ${rejected.join("\n- ")}` : ""}`;
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
- first_steps: 3–5 short actions the owner takes next in LeadGen OS (e.g. connect Google Ads, review landing page).
- This is a recommendation only; nothing is launched automatically.`;
}
