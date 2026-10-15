/**
 * Review queue (M5): what each item means and what can be corrected. Items are filed by the
 * database (migration 026); resolve_review_item() applies the decision.
 */

export const REVIEW_KINDS = {
  low_confidence: { label: "AI unsure", explain: "The AI was less than 60% sure of the call result." },
  emergency: { label: "Emergency", explain: "The caller described a safety emergency. Check that it was handled." },
  unclear: { label: "Unclear call", explain: "The AI could not tell how the call ended." },
  call_error: { label: "Call failed", explain: "The call failed on the phone provider's side." },
  unknown_service: { label: "Unknown service", explain: "The person talked about a job the AI could not match to your services." },
  disagreement: { label: "AI and result disagree", explain: "What happened later does not match what the AI concluded on the call." },
  high_value: { label: "High-value job", explain: "This job is far above your usual. Check the amount." },
} as const;
export type ReviewKind = keyof typeof REVIEW_KINDS;
export type ReviewField = "call_outcome" | "service" | "revenue";

export const REVIEW_ACTIONS = {
  approve: "Approve",
  correct: "Correct",
  reject: "Reject",
  unsure: "Not sure",
} as const;
export type ReviewAction = keyof typeof REVIEW_ACTIONS;

export const STATUS_LABELS = {
  open: "Open",
  approved: "Approved",
  corrected: "Corrected",
  rejected: "Rejected",
  unsure: "Not sure",
} as const;

/** What "Approve" means for each field, shown as the button's title. */
export const APPROVE_MEANS: Record<ReviewField, string> = {
  call_outcome: "The AI's call result is right",
  service: "Fine as it is",
  revenue: "The amount is right",
};
