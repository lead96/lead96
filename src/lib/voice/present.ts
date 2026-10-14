/**
 * Readable call details for the app: what the AI found out, labelled with the business's own
 * questions. Pure - unit-tested.
 */
import type { AgentQuestion } from "@/lib/setup/draft";
import { analysisKeyForQuestion, type CallOutcome } from "./agent-config";
import { OUTCOME_LABELS } from "./calls";

const URGENCY: Record<string, string> = {
  emergency: "Emergency",
  today_tomorrow: "Today or tomorrow",
  this_week: "This week",
  flexible: "Flexible",
};

const FIXED: { key: string; label: string }[] = [
  { key: "service", label: "Service" },
  { key: "urgency", label: "Urgency" },
  { key: "preferred_window", label: "Preferred visit" },
  { key: "service_address", label: "Address" },
  { key: "callback_time", label: "Call back" },
  { key: "emergency", label: "Emergency" },
  { key: "asked_for_human", label: "Asked for a person" },
];
const SKIP = new Set(["outcome", "confidence"]);

export type AnswerRow = { label: string; value: string };

function show(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Yes" : null;
  const s = String(v).trim();
  return s && s !== "unknown" ? s : null;
}

export function callAnswers(analysis: Record<string, unknown>, questions: AgentQuestion[], serviceLabel: (v: string) => string): AnswerRow[] {
  const rows: AnswerRow[] = [];
  const used = new Set<string>(SKIP);
  for (const q of questions) {
    const key = analysisKeyForQuestion(q);
    used.add(key);
    const v = show(analysis[key]);
    if (v) rows.push({ label: q.question, value: v });
  }
  for (const f of FIXED) {
    used.add(f.key);
    let v = show(analysis[f.key]);
    if (v && f.key === "service") v = serviceLabel(v);
    if (v && f.key === "urgency") v = URGENCY[v] ?? v;
    if (v) rows.push({ label: f.label, value: v });
  }
  // Answers to questions that were changed or removed since the call: still shown, with a plain label.
  for (const [k, raw] of Object.entries(analysis)) {
    if (used.has(k)) continue;
    const v = show(raw);
    if (v) rows.push({ label: k.replace(/^answer_/, "").replace(/^custom_\d+$/, "Extra question").replaceAll("_", " "), value: v });
  }
  return rows;
}

export const OUTCOME_TONES: Record<CallOutcome, "green" | "blue" | "slate" | "amber" | "red"> = {
  booked: "green",
  qualified: "green",
  transferred: "blue",
  callback: "blue",
  not_interested: "slate",
  not_qualified: "slate",
  voicemail: "slate",
  no_answer: "slate",
  wrong_number: "slate",
  do_not_call: "amber",
  other: "amber",
};

export function outcomeLabel(outcome: string | null, status: string): string {
  if (outcome && outcome in OUTCOME_LABELS) return OUTCOME_LABELS[outcome as CallOutcome];
  if (status === "queued" || status === "registered") return "Calling...";
  if (status === "ongoing") return "On the call";
  if (status === "error") return "Call failed";
  return "Waiting for result";
}

export const TRIGGER_LABELS: Record<string, string> = {
  fast_callback: "Called back a new lead",
  retry: "Retry",
  manual: "Started by your team",
  test: "Test call",
  inbound: "Incoming call",
};
