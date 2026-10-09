/**
 * Integration health for the Admin page: turns the numbers from admin_integration_health() and
 * which credentials are set into one status per integration. Pure - unit-tested.
 */

export type DeliveryStats = {
  total: number;
  ok_24h: number;
  ok_7d: number;
  failed_24h: number;
  failed_7d: number;
  invalid_24h: number;
  invalid_7d: number;
  no_contact_7d: number;
  retries_7d: number;
  last_ok_at: string | null;
  last_failed_at: string | null;
  last_invalid_at: string | null;
};
export type Problem = { at: string; status: "failed" | "rejected"; error: string | null; external_id: string | null };
export type SourceStats = { n_24h: number; n_7d: number; last_at: string | null };
export type WorkspaceHealth = {
  id: string;
  name: string;
  created_at: string;
  setup_completed_at: string | null;
  leads_7d: number;
  last_lead_at: string | null;
  published_pages: number;
  problems_7d: number;
};
export type HealthReport = {
  generated_at: string;
  deliveries: Partial<Record<"call" | "meta" | "google", DeliveryStats>>;
  last_problems: Partial<Record<"call" | "meta" | "google", Problem>>;
  leads: Partial<Record<string, SourceStats>>;
  imports_7d: { files: number; rows: number; failed: number; last_at: string | null };
  ai: { calls_24h: number; tokens_24h: number; tokens_7d: number; last_at: string | null };
  published_pages: number;
  workspaces: WorkspaceHealth[];
};

/** setup = credentials or build missing · idle = ready, nothing has come in yet. */
export type HealthState = "ok" | "warning" | "error" | "idle" | "setup";

export type Stat = { label: string; value: number | string | null; time?: boolean };
export type ConfigItem = { key: string; label: string; set: boolean };
export type Integration = {
  key: string;
  name: string;
  state: HealthState;
  summary: string;
  stats: Stat[];
  config?: ConfigItem[];
  problem?: Problem;
  /** Settings page for this integration, if it has one. */
  href?: string;
};

/** Credentials each integration needs (names only - values never leave the server). */
export const CONFIG: Record<string, { key: string; label: string }[]> = {
  call: [{ key: "INTAKE_SIGNING_SECRET", label: "Intake signing secret" }],
  openai: [{ key: "OPENAI_API_KEY", label: "OpenAI API key" }],
  google: [
    { key: "GOOGLE_CLIENT_ID", label: "OAuth client ID" },
    { key: "GOOGLE_CLIENT_SECRET", label: "OAuth client secret" },
    { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Google Ads developer token" },
    { key: "GOOGLE_ADS_MANAGER_ID", label: "Manager account (MCC) ID" },
    { key: "CREDENTIALS_ENCRYPTION_KEY", label: "Encryption key for stored sign-ins" },
    { key: "GOOGLE_ADS_CONNECTION", label: "Google Ads sign-in (Admin > Google Ads)" },
  ],
  meta: [
    { key: "META_APP_ID", label: "Meta app ID" },
    { key: "META_APP_SECRET", label: "Meta app secret" },
    { key: "META_SYSTEM_USER_TOKEN", label: "System User token" },
    { key: "META_BUSINESS_ID", label: "Business Manager ID" },
  ],
};

/** Ad integrations whose lead sync is built. Flip when Meta / Google intake ships. */
const BUILT = { meta: false, google: true };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const after = (a: string | null, b: string | null) => Boolean(a) && (!b || Date.parse(a!) > Date.parse(b));

export function buildIntegrations(r: HealthReport, isSet: (key: string) => boolean): Integration[] {
  const config = (k: string): ConfigItem[] => CONFIG[k].map((c) => ({ ...c, set: isSet(c.key) }));
  const missing = (items: ConfigItem[]) => items.filter((c) => !c.set).map((c) => c.label);
  const lp = r.leads.landing_page;

  return [
    webhook("call", "Call intake", "calls", config("call"), r.deliveries.call, r.last_problems.call, true, missing),
    {
      key: "landing_page",
      name: "Landing page forms",
      ...(r.published_pages === 0
        ? { state: "idle" as const, summary: "No published landing pages yet." }
        : lp?.n_7d
          ? { state: "ok" as const, summary: `${plural(lp.n_7d, "lead")} in the last 7 days.` }
          : { state: "idle" as const, summary: `${plural(r.published_pages, "page")} live, no form leads in the last 7 days.` }),
      stats: [
        { label: "Leads 24 h", value: lp?.n_24h ?? 0 },
        { label: "Leads 7 days", value: lp?.n_7d ?? 0 },
        { label: "Last lead", value: lp?.last_at ?? null, time: true },
        { label: "Live pages", value: r.published_pages },
      ],
    },
    {
      key: "csv",
      name: "CSV import",
      state: r.imports_7d.files ? "ok" : "idle",
      summary: r.imports_7d.files
        ? `${plural(r.imports_7d.files, "file")} imported in the last 7 days${r.imports_7d.failed ? `; ${plural(r.imports_7d.failed, "row")} skipped for missing contact details` : ""}.`
        : "No imports in the last 7 days.",
      stats: [
        { label: "Files 7 days", value: r.imports_7d.files },
        { label: "Rows 7 days", value: r.imports_7d.rows },
        { label: "Skipped rows", value: r.imports_7d.failed },
        { label: "Last import", value: r.imports_7d.last_at, time: true },
      ],
    },
    (() => {
      const items = config("openai");
      const stats: Stat[] = [
        { label: "AI calls 24 h", value: r.ai.calls_24h },
        { label: "Tokens 24 h", value: r.ai.tokens_24h },
        { label: "Tokens 7 days", value: r.ai.tokens_7d },
        { label: "Last use", value: r.ai.last_at, time: true },
      ];
      if (missing(items).length) return { key: "openai", name: "OpenAI", state: "setup" as const, summary: "API key missing - the setup chat can't run.", stats, config: items };
      return {
        key: "openai",
        name: "OpenAI",
        state: r.ai.last_at ? ("ok" as const) : ("idle" as const),
        summary: r.ai.last_at ? "Key set. Use 'Run live checks' to confirm it works." : "Key set, not used yet.",
        stats,
        config: items,
      };
    })(),
    webhook("google", "Google Ads", "leads", config("google"), r.deliveries.google, r.last_problems.google, BUILT.google, missing, r.leads.google),
    webhook("meta", "Meta (Facebook / Instagram)", "leads", config("meta"), r.deliveries.meta, r.last_problems.meta, BUILT.meta, missing, r.leads.meta),
  ];
}

function webhook(
  key: string,
  name: string,
  noun: string,
  items: ConfigItem[],
  s: DeliveryStats | undefined,
  problem: Problem | undefined,
  built: boolean,
  missing: (items: ConfigItem[]) => string[],
  leads?: SourceStats,
): Integration {
  const stats: Stat[] = [
    { label: `${cap(noun)} 24 h`, value: s?.ok_24h ?? leads?.n_24h ?? 0 },
    { label: `${cap(noun)} 7 days`, value: s?.ok_7d ?? leads?.n_7d ?? 0 },
    { label: "Last received", value: s?.last_ok_at ?? leads?.last_at ?? null, time: true },
    { label: "Retries 7 days", value: s?.retries_7d ?? 0 },
  ];
  if (key === "call") stats.push({ label: "Blocked caller ID 7 days", value: s?.no_contact_7d ?? 0 });
  const base = { key, name, stats, config: items, problem, href: key === "google" ? "/admin/google" : undefined };

  const absent = missing(items);
  if (absent.length) return { ...base, state: "setup", summary: `Waiting for: ${absent.join(", ")}.` };
  if (!built) return { ...base, state: "setup", summary: "Credentials ready. Lead sync is being built." };
  if (!s?.total) return { ...base, state: "idle", summary: `Ready. No ${noun} received yet.` };

  if (s.failed_24h && after(s.last_failed_at, s.last_ok_at)) {
    return { ...base, state: "error", summary: `Saving ${noun} is failing (${s.failed_24h} in 24 h). The sender will retry; check the error below.` };
  }
  if (s.failed_24h) return { ...base, state: "warning", summary: `${plural(s.failed_24h, "temporary failure")} in 24 h, recovered since.` };
  if (s.invalid_24h) {
    return { ...base, state: "warning", summary: `${plural(s.invalid_24h, "delivery", "deliveries")} rejected in 24 h for bad data - check the sender.` };
  }
  return { ...base, state: "ok", summary: s.ok_24h ? `${plural(s.ok_24h, noun.replace(/s$/, ""), noun)} in the last 24 h.` : `Working. Nothing received in the last 24 h.` };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Overall: the worst state among integrations that are expected to work now. */
export function overallState(list: Integration[]): HealthState {
  const order: HealthState[] = ["error", "warning", "ok", "idle", "setup"];
  return order.find((s) => list.some((i) => i.state === s)) ?? "idle";
}
