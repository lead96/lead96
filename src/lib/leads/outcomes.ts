import type { CustomerStatus } from "@/lib/leads/normalize";

/**
 * Job results (M5): reason lists and the rules the outcome form follows. The same rules are
 * enforced again by set_outcome() in the database (migration 022).
 */

export const NOT_QUALIFIED_REASONS = {
  outside_area: "Outside the service area",
  service_not_offered: "Service we don't offer",
  spam_or_wrong_number: "Spam or wrong number",
  no_real_need: "No real need",
  price_shopping: "Only comparing prices",
  duplicate: "Duplicate",
  other: "Other",
} as const;

export const LOST_REASONS = {
  price: "Price too high",
  competitor: "Chose a competitor",
  no_response: "Stopped answering",
  not_ready: "Not ready yet",
  financing: "Financing",
  changed_mind: "Changed their mind",
  other: "Other",
} as const;

export type NotQualifiedReason = keyof typeof NOT_QUALIFIED_REASONS;
export type LostReason = keyof typeof LOST_REASONS;

/** Final results: the job is closed. */
export const FINAL_STATUSES: CustomerStatus[] = ["won", "lost", "not_qualified"];

/** What the form asks for with each status. */
export function outcomeNeeds(status: CustomerStatus): { reason?: Record<string, string>; amount?: "estimate" | "revenue" } {
  if (status === "not_qualified") return { reason: NOT_QUALIFIED_REASONS };
  if (status === "lost") return { reason: LOST_REASONS };
  if (status === "won") return { amount: "revenue" };
  if (status === "estimate") return { amount: "estimate" };
  return {};
}

export function reasonLabel(code: string | null | undefined) {
  if (!code) return null;
  return (NOT_QUALIFIED_REASONS as Record<string, string>)[code] ?? (LOST_REASONS as Record<string, string>)[code] ?? code;
}

/** "$1,250" / "$1,250.50". */
export function money(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "-";
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : "-";
}

/** "1,250", "$1250.50", " 900 " -> number; null if not a positive amount under $10M. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const v = Number(s);
  return v > 0 && v < 10_000_000 ? v : null;
}
