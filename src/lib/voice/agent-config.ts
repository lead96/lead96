/**
 * Builds the AI caller for one business from its setup (demand profile, agent settings, questions).
 * Provider-neutral and pure - unit-tested. src/lib/voice/retell.ts turns it into Retell objects.
 *
 * The same config drives outbound calls (we call a new lead) and inbound calls (someone calls the
 * business number). Per-call facts arrive as dynamic variables ({{lead_name}} etc.).
 */
import { createHash } from "node:crypto";
import { WEEKDAYS, WEEKDAY_LABELS, type AgentQuestion, type BookingHours } from "@/lib/setup/draft";

/** Bump when the prompt text or analysis fields change, so every business gets re-synced. */
export const VOICE_PROMPT_VERSION = "2026-10-15.1";

export const CALL_OUTCOMES = [
  "booked",
  "qualified",
  "callback",
  "not_interested",
  "not_qualified",
  "voicemail",
  "no_answer",
  "transferred",
  "wrong_number",
  "do_not_call",
  "other",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Outcomes the AI itself can report after a conversation (the rest come from call status). */
export const SPOKEN_OUTCOMES = ["qualified", "callback", "not_interested", "not_qualified", "wrong_number", "do_not_call", "other"] as const;

export type AgentInput = {
  businessName: string;
  timezone: string;
  services: { value: string; label: string }[];
  customerTypes: string[];
  zipCodes: string[];
  areaDescription: string | null;
  bookingHours: BookingHours;
  appointmentMinutes: number;
  questions: AgentQuestion[];
  transferPhone: string | null;
  escalation: { on_request?: boolean; emergency?: boolean; low_confidence_below?: number };
  greeting: string | null;
};

export type AnalysisField =
  | { type: "string"; name: string; description: string }
  | { type: "enum"; name: string; description: string; choices: string[] }
  | { type: "boolean"; name: string; description: string }
  | { type: "number"; name: string; description: string };

export type VoiceAgentConfig = {
  promptVersion: string;
  agentName: string;
  prompt: string;
  /** Always "{{opening}}": the first sentence is chosen per call (inbound vs outbound). */
  beginMessage: string;
  /** Opening for outbound calls; {{lead_first_name}} and {{lead_service}} are filled per call. */
  outboundOpening: string;
  transferPhone: string | null;
  analysis: AnalysisField[];
  /** Fallbacks so {{variables}} never reach the caller unfilled (inbound calls have no lead yet). */
  dynamicDefaults: Record<string, string>;
};

/** Variables we pass on each outbound call. */
export type CallVariables = {
  opening: string;
  lead_name: string;
  lead_first_name: string;
  lead_service: string;
  lead_zip: string;
  lead_source: string;
  call_reason: string;
  known_caller: "yes" | "no";
};

const MAX_ZIPS_IN_PROMPT = 40;

const answerKey = (q: AgentQuestion) => `answer_${q.key.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`.slice(0, 60);

export function describeBookingHours(h: BookingHours): string {
  const lines = WEEKDAYS.filter((d) => h[d]?.length).map(
    (d) => `${WEEKDAY_LABELS[d]} ${h[d]!.map((r) => `${r.start}-${r.end}`).join(", ")}`,
  );
  return lines.length ? lines.join("; ") : "not set (do not offer specific days; say the team will confirm a time)";
}

function describeArea(i: AgentInput): string {
  if (!i.zipCodes.length) return i.areaDescription ?? "not set (take the address; the team will confirm coverage)";
  const zips =
    i.zipCodes.length <= MAX_ZIPS_IN_PROMPT
      ? `ZIP codes: ${i.zipCodes.join(", ")}`
      : `${i.zipCodes.length} ZIP codes (the team confirms coverage for any ZIP you are unsure about)`;
  return i.areaDescription ? `${i.areaDescription}; ${zips}` : zips;
}

function questionLine(q: AgentQuestion) {
  const choices = q.choices?.length ? ` (options: ${q.choices.join(", ")})` : "";
  return `- ${q.question}${choices}${q.required ? "" : " (optional)"}`;
}

export function buildAgentConfig(i: AgentInput): VoiceAgentConfig {
  const services = i.services.map((s) => s.label);
  const canTransfer = Boolean(i.transferPhone);
  const transferOnRequest = canTransfer && i.escalation.on_request !== false;
  const transferEmergency = canTransfer && i.escalation.emergency !== false;

  const prompt = `## Role
You are the virtual scheduling assistant for ${i.businessName}, a home-service contractor. You speak with people who asked for service or who call the business. Your job: understand the job, ask the qualification questions, and agree on a preferred visit window so the team can confirm it.

You are an AI assistant. Say so plainly if anyone asks whether you are a real person. Never pretend to be human.

## Facts about ${i.businessName}
- Services: ${services.length ? services.join(", ") : "general home services"}.
- Customers served: ${i.customerTypes.length ? i.customerTypes.join(", ") : "residential and commercial"}.
- Service area: ${describeArea(i)}.
- Visit hours (${i.timezone}): ${describeBookingHours(i.bookingHours)}. A visit takes about ${i.appointmentMinutes} minutes.

## This call
- Reason: {{call_reason}}
- Person: {{lead_name}} (known caller: {{known_caller}})
- Service they asked about: {{lead_service}}
- ZIP from their request: {{lead_zip}}
If a value says "unknown", ask for it instead of guessing.

## How to talk
- Short, friendly sentences. One question at a time. Let them finish; do not repeat questions they already answered.
- Plain US English. Read phone numbers and times naturally.
- Do not give prices, diagnoses or guarantees. Say a technician will go over it during the visit.
- Only offer visit windows that check_availability returned. Never invent days or times.

## Steps
1. Confirm it is a good time. If not, ask when to call back, thank them, and end the call.
2. Ask about the job, then these questions (skip any already answered):
${i.questions.map(questionLine).join("\n") || "- What is going on, and since when?"}
3. Confirm the service address or at least the ZIP code. If it is clearly outside the service area, say so politely and that the team will follow up if they can help.
4. Call check_availability, then offer two or three of the windows it returns (for example "Thursday 8 to 12, or Thursday afternoon"). If none suits them, ask what would work and note it.
5. When they choose a window, repeat back the day, window and address, then call book_appointment with that window and the address. If it says the window is no longer open, check availability again and offer another.
6. Close: thank them, confirm the visit is booked, and say they will get a reminder before the visit.

## Special cases
- Emergency (gas smell, carbon monoxide alarm, smoke, sparks, flooding): tell them to leave the building and call 911 or the gas company right away.${transferEmergency ? " Then transfer the call to the team." : " The team will call them back as a priority."}
- They ask for a person, a manager or the office: ${transferOnRequest ? "transfer the call to the team." : "say a team member will call them back shortly."}
- They ask not to be called again: apologize, confirm they will not be called again, and end the call.
- Wrong number or they never asked for service: apologize and end the call.
- They are not interested: thank them and end the call without pushing.
- Voicemail or an answering machine: end the call without leaving a message.`;

  const greeting = i.greeting?.trim();
  const outboundOpening =
    greeting && greeting.length > 5
      ? `${greeting.replace(/[.!?]?$/, ".")} This call may be recorded. Is now a good time?`
      : `Hi {{lead_first_name}}, this is the virtual assistant for ${i.businessName}, calling about your {{lead_service}} request. This call may be recorded. Is now a good time?`;
  const inboundOpening = `Thanks for calling ${i.businessName}. This is the virtual assistant, and this call may be recorded. How can I help?`;

  const analysis: AnalysisField[] = [
    {
      type: "enum",
      name: "outcome",
      description:
        "Result of the conversation. qualified = job and preferred visit window agreed; callback = asked to be called at another time; not_interested; not_qualified = outside area or a job the business does not do; wrong_number; do_not_call = asked not to be called again; other.",
      choices: [...SPOKEN_OUTCOMES],
    },
    {
      type: "number",
      name: "confidence",
      description: "How sure you are about the outcome and the answers, from 0 to 1.",
    },
    {
      type: "enum",
      name: "service",
      description: "The service the person needs.",
      choices: [...i.services.map((s) => s.value), "unknown"],
    },
    { type: "enum", name: "urgency", description: "How soon they need service.", choices: ["emergency", "today_tomorrow", "this_week", "flexible", "unknown"] },
    { type: "string", name: "preferred_window", description: "Preferred visit day and time window in their words, empty if none." },
    { type: "string", name: "service_address", description: "Service address or ZIP code they confirmed, empty if none." },
    { type: "string", name: "callback_time", description: "When they asked to be called back, empty if not asked." },
    { type: "boolean", name: "emergency", description: "True if they described a safety emergency (gas, CO, smoke, sparks, flooding)." },
    { type: "boolean", name: "asked_for_human", description: "True if they asked to speak with a person." },
    ...i.questions.map(
      (q): AnalysisField => ({
        type: "string",
        name: answerKey(q),
        description: `Their answer to: "${q.question}". Empty if not answered.`,
      }),
    ),
  ];

  return {
    promptVersion: VOICE_PROMPT_VERSION,
    agentName: `Lead96 - ${i.businessName}`.slice(0, 120),
    prompt,
    beginMessage: "{{opening}}",
    outboundOpening,
    transferPhone: i.transferPhone,
    analysis,
    dynamicDefaults: {
      opening: inboundOpening,
      call_reason: "inbound call to the business",
      lead_name: "unknown",
      lead_first_name: "there",
      lead_service: "service",
      lead_zip: "unknown",
      lead_source: "unknown",
      known_caller: "no",
    },
  };
}

/** Stable fingerprint: only re-sync Retell when something that reaches the caller changed. */
export function configHash(c: VoiceAgentConfig, extra: Record<string, unknown> = {}) {
  return createHash("sha256").update(JSON.stringify({ c, extra })).digest("hex").slice(0, 32);
}

/** Maps a question key to its analysis field, so answers can be stored under the question. */
export const analysisKeyForQuestion = answerKey;

/** Per-call variables for an outbound call to a new lead. */
export function leadCallVariables(
  config: Pick<VoiceAgentConfig, "outboundOpening">,
  l: {
    full_name: string | null;
    service: string | null;
    zip: string | null;
    source: string;
    serviceLabel: string | null;
    known: boolean;
  },
): CallVariables {
  const name = l.full_name?.trim() || "unknown";
  const first = name === "unknown" ? "there" : name.split(/\s+/)[0];
  const service = (l.serviceLabel ?? l.service ?? "service").toLowerCase();
  return {
    opening: config.outboundOpening.replaceAll("{{lead_first_name}}", first).replaceAll("{{lead_service}}", service),
    lead_name: name,
    lead_first_name: first,
    lead_service: service,
    lead_zip: l.zip ?? "unknown",
    lead_source: l.source,
    call_reason: "calling back a new service request they just sent",
    known_caller: l.known ? "yes" : "no",
  };
}

/** Per-call variables for an incoming call from someone the business already knows. */
export function inboundCallVariables(
  businessName: string,
  caller: { full_name: string | null; serviceLabel: string | null; zip: string | null } | null,
): Record<string, string> {
  const name = caller?.full_name?.trim();
  if (!caller || !name) return {};
  const first = name.split(/\s+/)[0];
  const service = (caller.serviceLabel ?? "service").toLowerCase();
  return {
    opening: `Thanks for calling ${businessName}. This is the virtual assistant, and this call may be recorded. Am I speaking with ${first}?`,
    lead_name: name,
    lead_first_name: first,
    lead_service: service,
    lead_zip: caller.zip ?? "unknown",
    known_caller: "yes",
    call_reason: `inbound call from an existing customer who asked about ${service} before`,
  };
}
