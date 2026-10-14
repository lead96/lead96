/**
 * May the AI call this lead now? Every automatic or manual AI call passes through here.
 * Pure - unit-tested. Result: call now, call later (with the time), or skip (with the reason).
 */

export const CALL_WINDOW = { startHour: 8, endHour: 20 }; // local time of the business, every day
export const MAX_ATTEMPTS = 3;
/** Delay before attempt 2, 3, ... after no answer / voicemail. */
export const RETRY_DELAYS_MIN = [15, 180];
export const RECENT_CALL_HOURS = 12;
const CLOSED_STATUSES = new Set(["appointment", "showed", "estimate", "won", "lost"]);

export type CallTrigger = "fast_callback" | "retry" | "manual";

export type EligibilityInput = {
  now: Date;
  timezone: string;
  trigger: CallTrigger;
  autoCall: boolean;
  agentReady: boolean;
  fromNumber: string | null;
  lead: { kind: string; source: string; phone: string | null; zip: string | null; consent_given: boolean } | null;
  customer: { status: string; do_not_call: boolean; phone: string | null };
  serviceZips: string[];
  /** Latest outbound AI call to this customer (not counting the job being decided). */
  lastOutboundCallAt: Date | null;
};

export type Eligibility = { ok: true; toNumber: string } | { ok: false; skip: true; reason: string } | { ok: false; skip: false; reason: string; retryAt: Date };

const skip = (reason: string): Eligibility => ({ ok: false, skip: true, reason });

/** Minutes since local midnight in a time zone. */
export function localMinutes(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Next start of the calling window (today or tomorrow) as an absolute time. */
export function nextWindowStart(now: Date, timezone: string) {
  const m = localMinutes(now, timezone);
  const start = CALL_WINDOW.startHour * 60;
  const wait = m < start ? start - m : 24 * 60 - m + start;
  const t = new Date(now.getTime() + wait * 60_000);
  t.setSeconds(0, 0);
  return t;
}

export function inCallWindow(now: Date, timezone: string) {
  const m = localMinutes(now, timezone);
  return m >= CALL_WINDOW.startHour * 60 && m < CALL_WINDOW.endHour * 60;
}

export function decideCall(i: EligibilityInput): Eligibility {
  if (i.trigger !== "manual" && !i.autoCall) return skip("Automatic calls are off for this business.");
  if (!i.agentReady) return skip("The AI caller is not set up yet.");
  if (!i.fromNumber) return skip("The business has no phone number for AI calls yet.");
  if (i.customer.do_not_call) return skip("Asked not to be called.");
  if (i.lead?.kind === "call" && i.trigger === "fast_callback") return skip("Inbound calls are not called back automatically.");
  if (i.trigger !== "manual" && CLOSED_STATUSES.has(i.customer.status)) return skip(`Customer is already ${i.customer.status}.`);

  const to = i.lead?.phone ?? i.customer.phone;
  if (!to) return skip("No phone number.");
  if (!/^\+1[2-9]\d{9}$/.test(to)) return skip("Not a US phone number.");

  if (!i.lead?.consent_given) {
    return skip(
      i.lead && ["google", "meta"].includes(i.lead.source)
        ? "The ad form did not show our AI-call consent text."
        : "No consent to AI calls on this lead.",
    );
  }
  if (i.serviceZips.length && i.lead.zip && !i.serviceZips.includes(i.lead.zip)) return skip(`ZIP ${i.lead.zip} is outside the service area.`);

  if (i.trigger === "fast_callback" && i.lastOutboundCallAt && i.now.getTime() - i.lastOutboundCallAt.getTime() < RECENT_CALL_HOURS * 3_600_000) {
    return skip("Already called recently.");
  }
  if (!inCallWindow(i.now, i.timezone)) {
    return { ok: false, skip: false, reason: "Outside calling hours.", retryAt: nextWindowStart(i.now, i.timezone) };
  }
  return { ok: true, toNumber: to };
}

/** When to try again after no answer / voicemail, or null when attempts are used up. */
export function retryTime(attempt: number, now: Date): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MIN[attempt - 1] ?? RETRY_DELAYS_MIN.at(-1)!;
  return new Date(now.getTime() + delay * 60_000);
}

export const TEXT_EVERY_HOURS = 24;

export type TextInput = {
  now: Date;
  timezone: string;
  smsReady: boolean;
  fromNumber: string | null;
  lead: { source: string; consent_given: boolean } | null;
  customer: { do_not_call: boolean; phone: string | null };
  /** Latest text conversation we started with this person. */
  lastTextAt: Date | null;
};

/** May we text this person now? Same consent and do-not-contact rules as calls; no deferral (skip). */
export function decideText(i: TextInput): { ok: true; toNumber: string } | { ok: false; reason: string } {
  if (!i.smsReady) return { ok: false, reason: "The text agent is not set up yet." };
  if (!i.fromNumber) return { ok: false, reason: "The business has no phone number for texts yet." };
  if (i.customer.do_not_call) return { ok: false, reason: "Asked not to be contacted." };
  if (!i.lead?.consent_given) return { ok: false, reason: "No consent to texts on this lead." };
  const to = i.customer.phone;
  if (!to || !/^\+1[2-9]\d{9}$/.test(to)) return { ok: false, reason: "No US phone number." };
  if (i.lastTextAt && i.now.getTime() - i.lastTextAt.getTime() < TEXT_EVERY_HOURS * 3_600_000) return { ok: false, reason: "Already texted recently." };
  if (!inCallWindow(i.now, i.timezone)) return { ok: false, reason: "Outside texting hours." };
  return { ok: true, toNumber: to };
}
