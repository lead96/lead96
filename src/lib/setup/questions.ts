/**
 * The setup chat's questions are written here, not by the model. Code decides what to
 * ask next (from what is still missing) and offers buttons; the model only interprets
 * the owner's answers. Pure functions — unit-tested.
 */
import { missingFields, type SetupDraft } from "./draft";
import type { SetupContext } from "./prompts";

export type ChatPrompt = { text: string; options?: string[]; allow_multiple?: boolean };

export const ALL_SERVICES_LABEL = "All services";
export const ALL_CUSTOMERS_LABEL = "All customers";
export const OTHER_HOURS_LABEL = "Other hours";
export const OTHER_BUDGET_LABEL = "Other amount";

export const HOURS_PRESETS: Record<string, { days: string[]; start: string; end: string }> = {
  "Mon–Fri 8am–5pm": { days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "17:00" },
  "Mon–Sat 8am–6pm": { days: ["mon", "tue", "wed", "thu", "fri", "sat"], start: "08:00", end: "18:00" },
  "Every day 7am–7pm": { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "07:00", end: "19:00" },
};

export function nextQuestion(draft: SetupDraft, ctx: SetupContext): ChatPrompt {
  const missing = missingFields(draft);
  switch (missing[0]) {
    case "services":
      return {
        text: "Which jobs do you want? Pick all that apply.",
        options: [...ctx.services.map((s) => s.label), ALL_SERVICES_LABEL],
        allow_multiple: true,
      };
    case "lead_types":
      return { text: "Do you want phone calls, web form leads, or both?", options: ["Phone calls", "Web forms", "Both"] };
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
      return { text: "How many jobs can you take per day?", options: ["2", "4", "6", "8", "10+"] };
    case "monthly_budget":
      return {
        text: "What's your monthly ad budget? A rough number is fine — you can change it later.",
        options: ["$500", "$1,000", "$2,000", "$5,000", OTHER_BUDGET_LABEL],
      };
    case "transfer_phone":
      return { text: "Which phone number should our AI transfer live calls to? (US number with area code)" };
    case "questions_confirmed":
      return {
        text:
          "Our AI asks every caller these questions:\n" +
          ctx.defaultQuestions.map((q) => `• ${q}`).join("\n") +
          "\n\nWant to add a question of your own?",
        options: ["Looks good", "Add a question"],
      };
    default:
      return { text: "That's everything I need. Check the summary on the right and press Save setup." };
  }
}

/** Opening message. Update mode lets the owner jump to what they want to change. */
export function greetingPrompt(ctx: SetupContext, isUpdate: boolean, draft: SetupDraft): ChatPrompt {
  if (isUpdate) {
    return {
      text: `Hi again! What would you like to change for ${ctx.businessName}?`,
      options: ["Services", "Service area", "Hours", "Capacity or budget", "Transfer phone", "AI call questions"],
    };
  }
  const first = nextQuestion(draft, ctx);
  return {
    ...first,
    text: `Hi! I'll set up ${ctx.businessName} so our AI can call and book your leads — about 2 minutes, mostly clicking.\n\n${first.text}`,
  };
}
