/**
 * The setup chat's questions are written here, not by the model. Code decides what to
 * ask next (from what is still missing) and offers buttons; button answers are mapped
 * here too, so only typed answers need the model. Pure functions — unit-tested.
 */
import { parseCityLabel } from "./area";
import { missingFields, type DraftUpdates, type RequiredField, type SetupDraft } from "./draft";
import type { SetupContext } from "./prompts";

export type ChatPrompt = {
  text: string;
  options?: string[];
  allow_multiple?: boolean;
  /** Radius the owner asked for, carried while they pick which city they meant. */
  radius_miles?: number;
};

export const ALL_SERVICES_LABEL = "All services";
export const ALL_CUSTOMERS_LABEL = "All customers";
export const OTHER_HOURS_LABEL = "Other hours";
export const OTHER_BUDGET_LABEL = "Other amount";
export const LOOKS_GOOD_LABEL = "Looks good";
export const ADD_QUESTION_LABEL = "Add a question";

export const HOURS_PRESETS: Record<string, { days: string[]; start: string; end: string }> = {
  "Mon–Fri 8am–5pm": { days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "17:00" },
  "Mon–Sat 8am–6pm": { days: ["mon", "tue", "wed", "thu", "fri", "sat"], start: "08:00", end: "18:00" },
  "Every day 7am–7pm": { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "07:00", end: "19:00" },
};

const LEAD_TYPE_CHOICES: Record<string, ("form" | "call")[]> = {
  "Phone calls": ["call"],
  "Web forms": ["form"],
  Both: ["form", "call"],
};
const CAPACITY_CHOICES = ["2", "4", "6", "8", "10+"];
const BUDGET_CHOICES = ["$500", "$1,000", "$2,000", "$5,000"];

/** Update mode: "what would you like to change?" buttons → the question to ask. */
const UPDATE_TOPICS: Record<string, RequiredField | "capacity_or_budget"> = {
  Services: "services",
  "Service area": "zip_codes",
  Hours: "booking_hours",
  "Capacity or budget": "capacity_or_budget",
  "Transfer phone": "transfer_phone",
  "AI call questions": "questions_confirmed",
};

export function questionFor(field: RequiredField | "capacity_or_budget" | undefined, ctx: SetupContext): ChatPrompt {
  switch (field) {
    case "services":
      return {
        text: "Which jobs do you want? Pick all that apply.",
        options: [...ctx.services.map((s) => s.label), ALL_SERVICES_LABEL],
        allow_multiple: true,
      };
    case "lead_types":
      return { text: "Do you want phone calls, web form leads, or both?", options: Object.keys(LEAD_TYPE_CHOICES) };
    case "customer_types":
      return {
        text: "Who are your customers?",
        options: [...ctx.customerTypes.map((c) => c.label), ALL_CUSTOMERS_LABEL],
        allow_multiple: true,
      };
    case "zip_codes":
      return {
        text: "Where do you work? Tell me a city and how far you travel — for example “Miami, 20 miles” — or paste your ZIP codes.",
      };
    case "booking_hours":
      return { text: "When can you take appointments?", options: [...Object.keys(HOURS_PRESETS), OTHER_HOURS_LABEL] };
    case "capacity_per_day":
      return { text: "How many jobs can you take per day?", options: CAPACITY_CHOICES };
    case "monthly_budget":
      return {
        text: "What's your monthly ad budget? A rough number is fine — you can change it later.",
        options: [...BUDGET_CHOICES, OTHER_BUDGET_LABEL],
      };
    case "capacity_or_budget":
      return { text: "Type your new numbers — for example “8 jobs a day, $3,000 a month”." };
    case "transfer_phone":
      return { text: "Which phone number should our AI transfer live calls to? (US number with area code)" };
    case "questions_confirmed":
      return {
        text:
          "Our AI asks every caller these questions:\n" +
          ctx.defaultQuestions.map((q) => `• ${q}`).join("\n") +
          "\n\nWant to add a question of your own?",
        options: [LOOKS_GOOD_LABEL, ADD_QUESTION_LABEL],
      };
    default:
      return { text: "That's everything I need. Check the summary on the right and press Save setup." };
  }
}

export function nextQuestion(draft: SetupDraft, ctx: SetupContext): ChatPrompt {
  return questionFor(missingFields(draft)[0], ctx);
}

/** Opening message. Update mode lets the owner jump to what they want to change. */
export function greetingPrompt(ctx: SetupContext, isUpdate: boolean, draft: SetupDraft): ChatPrompt {
  if (isUpdate) {
    return { text: `Hi again! What would you like to change for ${ctx.businessName}?`, options: Object.keys(UPDATE_TOPICS) };
  }
  const first = nextQuestion(draft, ctx);
  return {
    ...first,
    text: `Hi! I'll set up ${ctx.businessName} so our AI can call and book your leads — about 2 minutes, mostly clicking.\n\n${first.text}`,
  };
}

export type ButtonAnswer =
  | { kind: "updates"; updates: Partial<DraftUpdates> }
  | { kind: "ask"; prompt: ChatPrompt }
  | { kind: "area"; city: string; state: string };

/**
 * Map an answer made of button labels straight to draft updates — no model call.
 * Returns null for anything typed, so the model interprets it.
 */
export function resolveButtonAnswer(text: string, pending: ChatPrompt, ctx: SetupContext, draft: SetupDraft): ButtonAnswer | null {
  const options = pending.options ?? [];
  if (options.length === 0) return null;
  const answer = text.trim();
  const parts = options.includes(answer) ? [answer] : pending.allow_multiple ? answer.split(", ") : [];
  if (parts.length === 0 || !parts.every((p) => options.includes(p))) return null;
  const one = parts[0];

  // Questions with fixed answers.
  if (parts.includes(ALL_SERVICES_LABEL)) return { kind: "updates", updates: { services: ctx.services.map((s) => s.value) } };
  if (parts.includes(ALL_CUSTOMERS_LABEL)) return { kind: "updates", updates: { customer_types: ctx.customerTypes.map((c) => c.value) } };
  const services = parts.map((p) => ctx.services.find((s) => s.label === p)?.value);
  if (services.every(Boolean)) return { kind: "updates", updates: { services: services as string[] } };
  const customers = parts.map((p) => ctx.customerTypes.find((c) => c.label === p)?.value);
  if (customers.every(Boolean)) return { kind: "updates", updates: { customer_types: customers as string[] } };

  if (LEAD_TYPE_CHOICES[one]) return { kind: "updates", updates: { lead_types: LEAD_TYPE_CHOICES[one] } };
  if (HOURS_PRESETS[one]) {
    const h = HOURS_PRESETS[one];
    return { kind: "updates", updates: { booking_hours: h.days.map((day) => ({ day, start: h.start, end: h.end })) } };
  }
  if (CAPACITY_CHOICES.includes(one)) return { kind: "updates", updates: { capacity_per_day: parseInt(one, 10) } };
  if (BUDGET_CHOICES.includes(one)) return { kind: "updates", updates: { monthly_budget: Number(one.replace(/[$,]/g, "")) } };
  if (one === LOOKS_GOOD_LABEL) return { kind: "updates", updates: { questions_confirmed: true, extra_questions: draft.extra_questions } };

  // Buttons that open a follow-up question.
  if (one === OTHER_HOURS_LABEL) return { kind: "ask", prompt: { text: "Tell me your days and times — for example “Mon–Fri 8am–5pm, Sat 9am–1pm”." } };
  if (one === OTHER_BUDGET_LABEL) return { kind: "ask", prompt: { text: "How much per month? Just type the amount, for example $3,000." } };
  if (one === ADD_QUESTION_LABEL) return { kind: "ask", prompt: { text: "What question should our AI add? Type it the way you'd ask a customer." } };
  if (UPDATE_TOPICS[one]) return { kind: "ask", prompt: questionFor(UPDATE_TOPICS[one], ctx) };

  // "Which Springfield?" → "Springfield, IL"
  const city = parseCityLabel(one);
  if (city) return { kind: "area", ...city };
  return null;
}
