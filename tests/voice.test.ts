import { describe, expect, it } from "vitest";
import { buildAgentConfig, configHash, leadCallVariables, type AgentInput } from "@/lib/voice/agent-config";
import { signRetell, verifyRetell } from "@/lib/voice/signature";

const input: AgentInput = {
  businessName: "Cool Air HVAC",
  timezone: "America/Chicago",
  services: [
    { value: "repair", label: "AC / Heating Repair" },
    { value: "maintenance", label: "Maintenance / Tune-up" },
  ],
  customerTypes: ["Homeowner"],
  zipCodes: ["75201", "75204"],
  areaDescription: "Dallas, TX · 15 mi",
  bookingHours: { mon: [{ start: "08:00", end: "17:00" }], sat: [{ start: "09:00", end: "13:00" }] },
  appointmentMinutes: 60,
  questions: [
    { key: "system_type", question: "What type of system is it?", answer_type: "choice", choices: ["Central air", "Heat pump"], required: true },
    { key: "custom_1", question: "Do you have pets?", answer_type: "text", required: false },
  ],
  transferPhone: "+12145550199",
  escalation: { on_request: true, emergency: true },
  greeting: null,
};

describe("voice agent config", () => {
  it("puts the business facts, questions and hours into the prompt", () => {
    const c = buildAgentConfig(input);
    expect(c.prompt).toContain("virtual scheduling assistant for Cool Air HVAC");
    expect(c.prompt).toContain("AC / Heating Repair, Maintenance / Tune-up");
    expect(c.prompt).toContain("Dallas, TX · 15 mi; ZIP codes: 75201, 75204");
    expect(c.prompt).toContain("Mon 08:00-17:00; Sat 09:00-13:00");
    expect(c.prompt).toContain("- What type of system is it? (options: Central air, Heat pump)");
    expect(c.prompt).toContain("- Do you have pets? (optional)");
    expect(c.prompt).toContain("Never pretend to be human");
  });

  it("transfers only when a transfer number is set", () => {
    expect(buildAgentConfig(input).prompt).toContain("transfer the call to the team.");
    const noPhone = buildAgentConfig({ ...input, transferPhone: null });
    expect(noPhone.prompt).not.toContain("transfer the call");
    expect(noPhone.prompt).toContain("a team member will call them back shortly");
  });

  it("asks the AI to report an outcome, confidence and one answer per question", () => {
    const names = buildAgentConfig(input).analysis.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["outcome", "confidence", "service", "urgency", "answer_system_type", "answer_custom_1"]));
    const service = buildAgentConfig(input).analysis.find((a) => a.name === "service");
    expect(service).toMatchObject({ type: "enum", choices: ["repair", "maintenance", "unknown"] });
  });

  it("uses a different opening for inbound and outbound calls, both disclosing recording", () => {
    const c = buildAgentConfig(input);
    expect(c.beginMessage).toBe("{{opening}}");
    expect(c.dynamicDefaults.opening).toMatch(/^Thanks for calling Cool Air HVAC\. This is the virtual assistant, and this call may be recorded/);
    const v = leadCallVariables(c, { full_name: "Maria Lopez", service: "repair", zip: "75201", source: "landing_page", serviceLabel: "AC / Heating Repair", known: false });
    expect(v.opening).toBe(
      "Hi Maria, this is the virtual assistant for Cool Air HVAC, calling about your ac / heating repair request. This call may be recorded. Is now a good time?",
    );
    expect(v).toMatchObject({ lead_first_name: "Maria", lead_zip: "75201", known_caller: "no" });
  });

  it("handles leads without a name", () => {
    const v = leadCallVariables(buildAgentConfig(input), { full_name: null, service: null, zip: null, source: "google", serviceLabel: null, known: true });
    expect(v.opening).toMatch(/^Hi there, /);
    expect(v).toMatchObject({ lead_name: "unknown", lead_zip: "unknown", known_caller: "yes" });
  });

  it("hash changes only when the config changes", () => {
    expect(configHash(buildAgentConfig(input))).toBe(configHash(buildAgentConfig({ ...input })));
    expect(configHash(buildAgentConfig(input))).not.toBe(configHash(buildAgentConfig({ ...input, appointmentMinutes: 90 })));
  });
});

describe("Retell signature", () => {
  const body = JSON.stringify({ event: "call_ended", call: { call_id: "abc" } });
  it("accepts a fresh signature over the exact raw body", () => {
    expect(verifyRetell(body, "key_1", signRetell(body, "key_1"))).toBe(true);
  });
  it("rejects a changed body, wrong key, old timestamp or bad format", () => {
    const sig = signRetell(body, "key_1");
    expect(verifyRetell(body + " ", "key_1", sig)).toBe(false);
    expect(verifyRetell(body, "key_2", sig)).toBe(false);
    expect(verifyRetell(body, "key_1", signRetell(body, "key_1", Date.now() - 6 * 60_000))).toBe(false);
    expect(verifyRetell(body, "key_1", "nonsense")).toBe(false);
    expect(verifyRetell(body, "key_1", null)).toBe(false);
  });
});
