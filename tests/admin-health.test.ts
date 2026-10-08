import { describe, expect, it } from "vitest";
import { buildIntegrations, overallState, type DeliveryStats, type HealthReport } from "@/lib/admin/health";

const empty: HealthReport = {
  generated_at: "2026-10-09T12:00:00Z",
  deliveries: {},
  last_problems: {},
  leads: {},
  imports_7d: { files: 0, rows: 0, failed: 0, last_at: null },
  ai: { calls_24h: 0, tokens_24h: 0, tokens_7d: 0, last_at: null },
  published_pages: 0,
  workspaces: [],
};
const calls = (s: Partial<DeliveryStats>): DeliveryStats => ({
  total: 10, ok_24h: 0, ok_7d: 0, failed_24h: 0, failed_7d: 0, invalid_24h: 0, invalid_7d: 0, no_contact_7d: 0, retries_7d: 0,
  last_ok_at: null, last_failed_at: null, last_invalid_at: null, ...s,
});
const all = () => true;
const get = (r: HealthReport, key: string, isSet: (k: string) => boolean = all) => buildIntegrations(r, isSet).find((i) => i.key === key)!;

describe("integration health", () => {
  it("call intake: not set up, idle, working", () => {
    expect(get(empty, "call", () => false)).toMatchObject({ state: "setup", summary: expect.stringContaining("Intake signing secret") });
    expect(get(empty, "call").state).toBe("idle");
    expect(get({ ...empty, deliveries: { call: calls({ ok_24h: 3, last_ok_at: "2026-10-09T11:00:00Z" }) } }, "call")).toMatchObject({ state: "ok", summary: "3 calls in the last 24 h." });
  });

  it("call intake: failing until a later delivery succeeds, then a warning", () => {
    const failing = calls({ failed_24h: 2, last_failed_at: "2026-10-09T11:30:00Z", last_ok_at: "2026-10-09T10:00:00Z" });
    expect(get({ ...empty, deliveries: { call: failing } }, "call").state).toBe("error");
    const recovered = { ...failing, last_ok_at: "2026-10-09T11:45:00Z" };
    expect(get({ ...empty, deliveries: { call: recovered } }, "call").state).toBe("warning");
    expect(get({ ...empty, deliveries: { call: calls({ invalid_24h: 1, ok_24h: 5 }) } }, "call").state).toBe("warning");
    // Blocked caller IDs are normal, not a warning.
    expect(get({ ...empty, deliveries: { call: calls({ no_contact_7d: 4, ok_24h: 1 }) } }, "call").state).toBe("ok");
  });

  it("Google / Meta list exactly which credentials are missing", () => {
    const set = new Set(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    const g = get(empty, "google", (k) => set.has(k));
    expect(g.state).toBe("setup");
    expect(g.summary).toBe("Waiting for: Google Ads developer token, Manager account (MCC) ID, admin@lead96.com sign-in.");
    expect(g.config!.filter((c) => c.set).map((c) => c.key)).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(get(empty, "meta").summary).toContain("Lead sync is being built");
  });

  it("landing pages, CSV and OpenAI reflect activity", () => {
    expect(get(empty, "landing_page").summary).toBe("No published landing pages yet.");
    expect(get({ ...empty, published_pages: 2, leads: { landing_page: { n_24h: 1, n_7d: 4, last_at: "2026-10-09T10:00:00Z" } } }, "landing_page")).toMatchObject({ state: "ok", summary: "4 leads in the last 7 days." });
    expect(get({ ...empty, imports_7d: { files: 1, rows: 30, failed: 2, last_at: "2026-10-09T10:00:00Z" } }, "csv").summary).toContain("2 rows skipped");
    expect(get(empty, "openai", () => false).state).toBe("setup");
    expect(get({ ...empty, ai: { ...empty.ai, last_at: "2026-10-09T10:00:00Z" } }, "openai").state).toBe("ok");
  });

  it("overall status is the worst one", () => {
    const list = buildIntegrations({ ...empty, deliveries: { call: calls({ invalid_24h: 1 }) } }, all);
    expect(overallState(list)).toBe("warning");
    expect(overallState(buildIntegrations(empty, all))).toBe("idle");
  });
});
