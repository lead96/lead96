/**
 * Campaign plan post-processing. The model proposes channels and wording; every
 * number shown to the owner is computed here from the saved profile.
 */
import type { SetupDraft } from "./draft";
import { LANDING_TEMPLATES, PLAN_CHANNELS } from "./prompts";

export type PlanModelOutput = {
  summary: string;
  channels: { channel: string; share_percent: number; reason: string }[];
  landing_page_template: string;
  template_reason: string;
  targeting_notes: string;
  first_steps: string[];
};

export type CampaignPlan = {
  channels: { channel: string; label: string; share_percent: number; monthly_amount: number | null; reason: string }[];
  landing_page_template: string;
  landing_page_label: string;
  template_reason: string;
  targeting_notes: string;
  first_steps: string[];
  budget: { monthly: number | null; daily: number | null };
  /** budget / target cost per appointment - simple arithmetic, not a forecast. */
  budget_covers_appointments: number | null;
  service_area_zip_codes: string[];
};

/** Split 100% across channels with integer shares that always sum to exactly 100. */
export function normalizeShares(shares: number[]): number[] {
  const clean = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total === 0) return shares.map((_, i) => (i === 0 ? 100 : 0));
  const raw = clean.map((s) => (s / total) * 100);
  const floored = raw.map(Math.floor);
  let rest = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floored[i] += 1;
    rest -= 1;
  }
  return floored;
}

export function buildPlan(out: PlanModelOutput, draft: SetupDraft): { summary: string; plan: CampaignPlan } {
  // Allowed channels only, each once; lead-type rules enforced in code, not just in the prompt.
  const seen = new Set<string>();
  let channels = out.channels.filter((c) => {
    const known = PLAN_CHANNELS.some((p) => p.value === c.channel);
    if (!known || seen.has(c.channel)) return false;
    seen.add(c.channel);
    return true;
  });
  const callsOnly = draft.lead_types.length === 1 && draft.lead_types[0] === "call";
  const formsOnly = draft.lead_types.length === 1 && draft.lead_types[0] === "form";
  if (formsOnly) channels = channels.filter((c) => c.channel !== "google_call_ads");
  if (callsOnly) channels = channels.filter((c) => c.channel !== "meta_lead_ads");
  if (channels.length === 0) {
    channels = [{ channel: "google_search", share_percent: 100, reason: "Reaches people searching for HVAC help in your area." }];
  }

  const shares = normalizeShares(channels.map((c) => c.share_percent));
  const monthly = draft.monthly_budget;
  const template = LANDING_TEMPLATES.find((t) => t.value === out.landing_page_template) ?? LANDING_TEMPLATES[1];

  return {
    summary: out.summary.trim(),
    plan: {
      channels: channels.map((c, i) => ({
        channel: c.channel,
        label: PLAN_CHANNELS.find((p) => p.value === c.channel)!.label,
        share_percent: shares[i],
        monthly_amount: monthly === null ? null : Math.round((monthly * shares[i]) / 100),
        reason: c.reason.trim(),
      })),
      landing_page_template: template.value,
      landing_page_label: template.label,
      template_reason: out.template_reason.trim(),
      targeting_notes: out.targeting_notes.trim(),
      first_steps: out.first_steps.map((s) => s.trim()).filter(Boolean).slice(0, 5),
      budget: { monthly, daily: monthly === null ? null : Math.round((monthly / 30.4) * 100) / 100 },
      budget_covers_appointments:
        monthly && draft.target_cost_per_appointment ? Math.floor(monthly / draft.target_cost_per_appointment) : null,
      service_area_zip_codes: draft.zip_codes,
    },
  };
}
