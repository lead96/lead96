import { describe, expect, it } from "vitest";
import { decideCall, inCallWindow, nextWindowStart, retryTime, type EligibilityInput } from "@/lib/voice/eligibility";

// 2026-10-14 15:00 UTC = 10:00 in Chicago (CDT, UTC-5).
const tenAmChicago = new Date("2026-10-14T15:00:00Z");
const base: EligibilityInput = {
  now: tenAmChicago,
  timezone: "America/Chicago",
  trigger: "fast_callback",
  autoCall: true,
  agentReady: true,
  fromNumber: "+12145550100",
  lead: { kind: "form", source: "landing_page", phone: "+12145550142", zip: "75201", consent_given: true },
  customer: { status: "new", do_not_call: false, phone: "+12145550142" },
  serviceZips: ["75201", "75204"],
  lastOutboundCallAt: null,
};
const reason = (i: Partial<EligibilityInput>) => {
  const d = decideCall({ ...base, ...i });
  return d.ok ? "ok" : d.reason;
};

describe("AI call eligibility", () => {
  it("calls a consented, in-area lead during calling hours", () => {
    expect(decideCall(base)).toEqual({ ok: true, toNumber: "+12145550142" });
  });

  it("needs automatic calls on, an AI caller and a number", () => {
    expect(reason({ autoCall: false })).toMatch(/off/);
    expect(reason({ autoCall: false, trigger: "manual" })).toBe("ok");
    expect(reason({ agentReady: false })).toMatch(/not set up/);
    expect(reason({ fromNumber: null })).toMatch(/no phone number for AI calls/);
  });

  it("never calls people who asked not to be called, or without consent", () => {
    expect(reason({ customer: { ...base.customer, do_not_call: true } })).toBe("Asked not to be called.");
    expect(reason({ customer: { ...base.customer, do_not_call: true }, trigger: "manual" })).toBe("Asked not to be called.");
    expect(reason({ lead: { ...base.lead!, consent_given: false } })).toMatch(/No consent/);
    expect(reason({ lead: { ...base.lead!, source: "google", consent_given: false } })).toMatch(/ad form did not show our AI-call consent/);
  });

  it("skips non-US numbers, other areas, inbound calls and closed customers", () => {
    expect(reason({ lead: { ...base.lead!, phone: "+442071234567" } })).toBe("Not a US phone number.");
    expect(reason({ lead: { ...base.lead!, zip: "10001" } })).toMatch(/outside the service area/);
    expect(reason({ lead: { ...base.lead!, zip: null } })).toBe("ok");
    expect(reason({ serviceZips: [], lead: { ...base.lead!, zip: "10001" } })).toBe("ok");
    expect(reason({ lead: { ...base.lead!, kind: "call" } })).toMatch(/Inbound/);
    expect(reason({ customer: { ...base.customer, status: "won" } })).toMatch(/already won/);
    expect(reason({ customer: { ...base.customer, status: "won" }, trigger: "manual" })).toBe("ok");
  });

  it("does not call the same person twice for duplicate leads", () => {
    expect(reason({ lastOutboundCallAt: new Date(tenAmChicago.getTime() - 2 * 3_600_000) })).toBe("Already called recently.");
    expect(reason({ lastOutboundCallAt: new Date(tenAmChicago.getTime() - 13 * 3_600_000) })).toBe("ok");
    expect(reason({ lastOutboundCallAt: new Date(tenAmChicago.getTime() - 20 * 60_000), trigger: "retry" })).toBe("ok");
  });

  it("waits for calling hours (8am-8pm business time) instead of calling at night", () => {
    const night = new Date("2026-10-15T03:30:00Z"); // 22:30 Chicago
    const d = decideCall({ ...base, now: night });
    expect(d).toMatchObject({ ok: false, skip: false, reason: "Outside calling hours." });
    // Next start: 08:00 Chicago = 13:00 UTC the next day.
    expect(!d.ok && !d.skip && d.retryAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect(nextWindowStart(new Date("2026-10-15T11:00:00Z"), "America/Chicago").toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect(inCallWindow(new Date("2026-10-15T00:59:00Z"), "America/Chicago")).toBe(true); // 19:59
    expect(inCallWindow(new Date("2026-10-15T01:00:00Z"), "America/Chicago")).toBe(false); // 20:00
  });

  it("retries after no answer: 15 minutes, then 3 hours, then stops", () => {
    expect(retryTime(1, tenAmChicago)?.toISOString()).toBe("2026-10-14T15:15:00.000Z");
    expect(retryTime(2, tenAmChicago)?.toISOString()).toBe("2026-10-14T18:00:00.000Z");
    expect(retryTime(3, tenAmChicago)).toBeNull();
  });
});
