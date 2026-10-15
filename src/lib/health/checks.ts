/**
 * Data health checks (M5). Counts and lists come from data_health() / data_health_list()
 * (migration 027). "info" checks are expected to be non-zero; the rest should be 0.
 */

export const HEALTH_CHECKS = {
  contact_no_consent: {
    label: "Contacted without consent",
    explain: "AI calls or texts to people with no consent on any of their leads. This must stay at 0.",
    fix: "Open each customer and check how they came in. Tell Lead96 if this is not 0.",
    info: false,
  },
  visit_no_outcome: {
    label: "Visits without a result",
    explain: "Visits whose time has passed but are still marked as booked.",
    fix: "Mark each one done, no-show or did not happen on the Outcomes page.",
    info: false,
  },
  won_no_revenue: {
    label: "Won without revenue",
    explain: "Won jobs with no amount, so they are missing from revenue and cost per job.",
    fix: "Open the customer and save Won again with the revenue.",
    info: false,
  },
  duplicates: {
    label: "Possible duplicates",
    explain: "Two customers share a phone number or email in a way that suggests one person.",
    fix: "Merge them, or mark them as different people.",
    info: false,
  },
  missing_transcript: {
    label: "Calls without a transcript",
    explain: "Answered AI calls where no transcript arrived from the phone provider.",
    fix: "Open the call. If it keeps happening, tell Lead96.",
    info: false,
  },
  missing_source: {
    label: "Leads without campaign data",
    explain: "Ad, landing page and website leads that came without a campaign, UTM tag or click ID, so they can't be tied to an ad.",
    fix: "Add UTM tags to your ad links (Lead96 can help). Old leads can't be fixed.",
    info: false,
  },
  lead_no_consent: {
    label: "Leads without consent",
    explain: "Leads who did not tick the consent box. The AI never calls or texts them; your team can.",
    fix: "Nothing to fix: call them yourself.",
    info: true,
  },
} as const;
export type HealthCheck = keyof typeof HEALTH_CHECKS;
export const HEALTH_ORDER = Object.keys(HEALTH_CHECKS) as HealthCheck[];

export type HealthRow = {
  customer_id: string | null;
  other_customer_id?: string;
  lead_id?: string;
  call_id?: string;
  appointment_id?: string;
  at: string;
  detail: string | null;
};

/** Checks with problems / all problem checks (info checks don't count). */
export function healthScore(counts: Partial<Record<HealthCheck, number>>) {
  const problems = HEALTH_ORDER.filter((k) => !HEALTH_CHECKS[k].info);
  const failing = problems.filter((k) => (counts[k] ?? 0) > 0);
  return { failing: failing.length, total: problems.length };
}
