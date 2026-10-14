import { describe, expect, it } from "vitest";
import type { AgentInput } from "@/lib/voice/agent-config";
import { decideText, type TextInput } from "@/lib/voice/eligibility";
import { buildSmsConfig, noAnswerText } from "@/lib/voice/sms-config";

describe("first text after a missed AI call", () => {
  it("names the business, the reason, a callback number and how to opt out", () => {
    expect(noAnswerText({ businessName: "Cool Air HVAC", firstName: "Maria", serviceLabel: "AC / Heating Repair", callbackNumber: "+12145550100" })).toBe(
      "Hi Maria, this is Cool Air HVAC. We just tried to call about your ac / heating repair request. Reply here with a good time for a visit, or call us back at (214) 555-0100. Reply STOP to opt out.",
    );
    expect(noAnswerText({ businessName: "Cool Air HVAC", firstName: null, serviceLabel: null, callbackNumber: null })).toBe(
      "Hi, this is Cool Air HVAC. We just tried to call about your request. Reply here with a good time for a visit. Reply STOP to opt out.",
    );
  });
  it("stays short even with long names", () => {
    const t = noAnswerText({ businessName: "X".repeat(200), firstName: "Maria", serviceLabel: "Y".repeat(200), callbackNumber: "+12145550100" });
    expect(t.length).toBeLessThanOrEqual(320);
    expect(t).toMatch(/Reply STOP to opt out\.$/);
  });
});

describe("text agent", () => {
  const input = {
    businessName: "Cool Air HVAC",
    timezone: "America/Chicago",
    services: [{ value: "repair", label: "AC / Heating Repair" }],
    customerTypes: [],
    zipCodes: [],
    areaDescription: null,
    bookingHours: { mon: [{ start: "08:00", end: "17:00" }] },
    appointmentMinutes: 60,
    questions: [],
    transferPhone: null,
    escalation: {},
    greeting: null,
  } as AgentInput;
  it("texts as the business, admits being an AI, honours STOP", () => {
    const c = buildSmsConfig(input);
    expect(c.beginMessage).toBe("{{sms_opening}}");
    expect(c.prompt).toContain("on behalf of Cool Air HVAC");
    expect(c.prompt).toContain("Never pretend to be human");
    expect(c.prompt).toMatch(/STOP.*confirm they will get no more messages/);
    expect(c.analysis.map((a) => a.name)).toEqual(["outcome", "preferred_window", "opt_out"]);
  });
});

describe("may we text?", () => {
  const now = new Date("2026-10-14T15:00:00Z"); // 10:00 Chicago
  const base: TextInput = {
    now,
    timezone: "America/Chicago",
    smsReady: true,
    fromNumber: "+12145550100",
    lead: { source: "landing_page", consent_given: true },
    customer: { do_not_call: false, phone: "+12145550142" },
    lastTextAt: null,
  };
  const r = (i: Partial<TextInput>) => {
    const d = decideText({ ...base, ...i });
    return d.ok ? "ok" : d.reason;
  };
  it("texts consented people once a day, in daytime, never after an opt-out", () => {
    expect(r({})).toBe("ok");
    expect(r({ customer: { do_not_call: true, phone: "+12145550142" } })).toMatch(/not to be contacted/);
    expect(r({ lead: { source: "google", consent_given: false } })).toMatch(/No consent/);
    expect(r({ lastTextAt: new Date(now.getTime() - 3_600_000) })).toMatch(/recently/);
    expect(r({ lastTextAt: new Date(now.getTime() - 25 * 3_600_000) })).toBe("ok");
    expect(r({ now: new Date("2026-10-15T04:00:00Z") })).toMatch(/hours/);
    expect(r({ smsReady: false })).toMatch(/not set up/);
    expect(r({ customer: { do_not_call: false, phone: "+442071234567" } })).toMatch(/US phone/);
  });
});
