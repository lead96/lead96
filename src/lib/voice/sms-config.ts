/**
 * The business's text agent (Retell chat agent over SMS) and the first text after a missed AI call.
 * Pure - unit-tested. Same facts as the voice agent; written for short texts.
 */
import type { AgentInput, AnalysisField } from "./agent-config";
import { describeBookingHours } from "./agent-config";

export const SMS_PROMPT_VERSION = "2026-10-14.1";
const MAX_FIRST_TEXT = 300;

export type SmsAgentConfig = {
  promptVersion: string;
  agentName: string;
  prompt: string;
  /** Always "{{sms_opening}}": the first text is written by us (no AI wording on the first message). */
  beginMessage: string;
  analysis: AnalysisField[];
  dynamicDefaults: Record<string, string>;
};

export function buildSmsConfig(i: AgentInput): SmsAgentConfig {
  const services = i.services.map((s) => s.label);
  const prompt = `## Role
You text on behalf of ${i.businessName}, a home-service contractor, with people who asked for service. We tried to call them and they did not answer, so we texted them. Help them by text: understand the job and agree on a preferred visit time so the team can confirm it.

You are an AI assistant. Say so if anyone asks. Never pretend to be human.

## Facts
- Services: ${services.length ? services.join(", ") : "general home services"}.
- Visit hours (${i.timezone}): ${describeBookingHours(i.bookingHours)}.
- Person: {{lead_name}}. Service they asked about: {{lead_service}}. ZIP: {{lead_zip}}.

## How to text
- One or two short sentences per message. Plain words, no emojis, no links.
- Ask one question at a time: what is going on, and which day and time window suits them.
- Do not give prices or guarantees. Say the team will confirm the visit time shortly.
- If they want a call, say the team will call them shortly.
- If they reply STOP, unsubscribe or ask not to be contacted: confirm they will get no more messages and stop.
- If it is a wrong number: apologize and stop.
- Emergency (gas smell, carbon monoxide, smoke, sparks, flooding): tell them to leave the building and call 911 or the gas company now.`;

  return {
    promptVersion: SMS_PROMPT_VERSION,
    agentName: `Lead96 SMS - ${i.businessName}`.slice(0, 120),
    prompt,
    beginMessage: "{{sms_opening}}",
    analysis: [
      {
        type: "enum",
        name: "outcome",
        description: "qualified = job and preferred time agreed; callback = wants a call; not_interested; wrong_number; do_not_call = asked to stop; no_reply = never answered; other.",
        choices: ["qualified", "callback", "not_interested", "wrong_number", "do_not_call", "no_reply", "other"],
      },
      { type: "string", name: "preferred_window", description: "Preferred visit day and time window in their words, empty if none." },
      { type: "boolean", name: "opt_out", description: "True if they asked to stop receiving messages or calls." },
    ],
    dynamicDefaults: { sms_opening: `Hi, this is ${i.businessName}. Reply here and we will help you set up a visit. Reply STOP to opt out.`, lead_name: "unknown", lead_service: "service", lead_zip: "unknown" },
  };
}

const prettyPhone = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

/** The first text after a missed AI call. Identifies the business, says why, and how to opt out. */
export function noAnswerText(p: { businessName: string; firstName: string | null; serviceLabel: string | null; callbackNumber: string | null }) {
  const hi = p.firstName ? `Hi ${p.firstName}` : "Hi";
  const about = p.serviceLabel ? ` about your ${p.serviceLabel.toLowerCase()} request` : " about your request";
  const back = p.callbackNumber ? `, or call us back at ${prettyPhone(p.callbackNumber)}` : "";
  const text = `${hi}, this is ${p.businessName}. We just tried to call${about}. Reply here with a good time for a visit${back}. Reply STOP to opt out.`;
  return text.length <= MAX_FIRST_TEXT ? text : `${hi}, this is ${p.businessName}. We just tried to call about your request. Reply here to book a visit. Reply STOP to opt out.`;
}
