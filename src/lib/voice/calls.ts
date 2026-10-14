/**
 * Retell call object -> our `calls` row, outcome and follow-ups. Pure - unit-tested.
 *
 * Outcome comes from how the call ended first (no answer, voicemail, transfer, do-not-call), then
 * from the AI's own post-call analysis. Anything unsure is flagged for human review.
 */
import { SPOKEN_OUTCOMES, type CallOutcome } from "./agent-config";

export type RetellCall = {
  call_id: string;
  agent_id?: string;
  agent_version?: number;
  call_status: "registered" | "not_connected" | "ongoing" | "ended" | "error";
  direction?: "inbound" | "outbound";
  call_type?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  transcript_object?: { role: string; content: string }[];
  recording_url?: string;
  metadata?: unknown;
  retell_llm_dynamic_variables?: Record<string, string>;
  transfer_destination?: string | null;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
    in_voicemail?: boolean;
    custom_analysis_data?: unknown;
  };
  call_cost?: { combined_cost?: number };
};

/** What we put in call metadata when we start a call, so the webhook knows where it belongs. */
export type CallMetadata = { workspace_id?: string; customer_id?: string; lead_id?: string; call_row_id?: string; trigger?: string };

const NO_ANSWER = new Set(["dial_no_answer", "dial_busy", "user_declined", "registered_call_timeout"]);
const FAILED = new Set([
  "dial_failed",
  "invalid_destination",
  "telephony_provider_permission_denied",
  "telephony_provider_unavailable",
  "sip_routing_error",
  "marked_as_spam",
  "network_blocked",
  "concurrency_limit_reached",
  "no_concurrency_fallback",
  "no_valid_payment",
  "credit_exhausted",
  "budget_reached",
]);
const TRANSFERRED = new Set(["call_transfer", "transfer_bridged"]);

export const REVIEW_BELOW_CONFIDENCE = 0.6;

export function callMetadata(call: Pick<RetellCall, "metadata">): CallMetadata {
  const m = call.metadata;
  if (!m || typeof m !== "object") return {};
  const out: CallMetadata = {};
  for (const k of ["workspace_id", "customer_id", "lead_id", "call_row_id", "trigger"] as const) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

function analysisData(call: RetellCall): Record<string, unknown> {
  const d = call.call_analysis?.custom_analysis_data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

export function deriveOutcome(call: RetellCall): CallOutcome | null {
  if (call.call_status === "registered" || call.call_status === "ongoing") return null;
  const reason = call.disconnection_reason ?? "";
  if (reason === "user_requested_dnc") return "do_not_call";
  if (NO_ANSWER.has(reason) || (call.call_status === "not_connected" && !FAILED.has(reason))) return "no_answer";
  if (reason === "voicemail_reached" || reason === "ivr_reached" || call.call_analysis?.in_voicemail) return "voicemail";
  if (TRANSFERRED.has(reason) || call.transfer_destination) return "transferred";
  if (FAILED.has(reason) || call.call_status === "error") return "other";
  const said = analysisData(call).outcome;
  if (typeof said === "string" && (SPOKEN_OUTCOMES as readonly string[]).includes(said)) return said as CallOutcome;
  if (reason === "user_requested_callback") return "callback";
  return call.call_analysis ? "other" : null;
}

function confidenceOf(call: RetellCall): number | null {
  const c = Number(analysisData(call).confidence);
  return Number.isFinite(c) ? Math.min(1, Math.max(0, Math.round(c * 100) / 100)) : null;
}

export type CallRowUpdate = {
  status: RetellCall["call_status"];
  direction?: "inbound" | "outbound";
  from_number?: string | null;
  to_number?: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  disconnection_reason: string | null;
  transcript: { role: "agent" | "user"; content: string }[] | null;
  summary: string | null;
  sentiment: string | null;
  analysis: Record<string, unknown>;
  confidence: number | null;
  outcome: CallOutcome | null;
  transferred: boolean;
  needs_review: boolean;
  cost_usd: number | null;
  agent_version: number | null;
};

/** Every field we keep from a Retell call; null where Retell has not sent it yet. */
export function callRowFromRetell(call: RetellCall): CallRowUpdate {
  const outcome = deriveOutcome(call);
  const confidence = confidenceOf(call);
  const data = analysisData(call);
  const analyzed = Boolean(call.call_analysis);
  const needs_review =
    analyzed &&
    outcome !== "no_answer" &&
    outcome !== "voicemail" &&
    (data.emergency === true ||
      outcome === "other" ||
      (outcome !== "transferred" && confidence !== null && confidence < REVIEW_BELOW_CONFIDENCE) ||
      call.call_status === "error");
  return {
    status: call.call_status,
    direction: call.direction,
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? null,
    started_at: iso(call.start_timestamp),
    ended_at: iso(call.end_timestamp),
    duration_seconds: call.duration_ms != null ? Math.round(call.duration_ms / 1000) : null,
    disconnection_reason: call.disconnection_reason ?? null,
    transcript: call.transcript_object?.length
      ? call.transcript_object
          .filter((t) => t.content?.trim())
          .map((t) => ({ role: t.role === "agent" ? ("agent" as const) : ("user" as const), content: t.content.slice(0, 4000) }))
      : null,
    summary: call.call_analysis?.call_summary?.slice(0, 4000) ?? null,
    sentiment: call.call_analysis?.user_sentiment ?? null,
    analysis: data,
    confidence,
    outcome,
    transferred: outcome === "transferred",
    needs_review,
    cost_usd: call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost * 100) / 10000 : null,
    agent_version: call.agent_version ?? null,
  };
}

/** A call where the caller chose a visit window counts as booked (not for no answer, transfer, do-not-call...). */
export function withBooking(u: CallRowUpdate, booked: boolean): CallRowUpdate {
  if (!booked || !["qualified", "callback", "other"].includes(u.outcome ?? "")) return u;
  return { ...u, outcome: "booked", needs_review: u.analysis.emergency === true || (u.confidence !== null && u.confidence < 0.6) };
}

/** Customer status after an AI call: only ever moves forward from new/contacted. */
export function statusAfterCall(current: string, outcome: CallOutcome | null): string | null {
  if (!outcome || !["new", "contacted"].includes(current)) return null;
  if (outcome === "qualified" || outcome === "booked") return current === "qualified" ? null : "qualified";
  const spoke = ["callback", "not_interested", "not_qualified", "transferred", "do_not_call", "other"].includes(outcome);
  return spoke && current === "new" ? "contacted" : null;
}

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  booked: "Booked",
  qualified: "Qualified",
  callback: "Call back later",
  not_interested: "Not interested",
  not_qualified: "Not a fit",
  voicemail: "Voicemail",
  no_answer: "No answer",
  transferred: "Transferred to team",
  wrong_number: "Wrong number",
  do_not_call: "Asked not to be called",
  other: "Needs review",
};
