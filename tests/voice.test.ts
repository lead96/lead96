import { describe, expect, it } from "vitest";
import { buildAgentConfig, configHash, inboundCallVariables, leadCallVariables, type AgentInput } from "@/lib/voice/agent-config";
import { callRowFromRetell, deriveOutcome, statusAfterCall, withBooking, type RetellCall } from "@/lib/voice/calls";
import { callAnswers, outcomeLabel } from "@/lib/voice/present";
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


const ended = (over: Partial<RetellCall> = {}): RetellCall => ({
  call_id: "c1",
  call_status: "ended",
  direction: "outbound",
  start_timestamp: 1_790_000_000_000,
  end_timestamp: 1_790_000_095_000,
  duration_ms: 95_000,
  disconnection_reason: "agent_hangup",
  transcript_object: [
    { role: "agent", content: "Hi Maria" },
    { role: "user", content: "Yes, the AC stopped." },
    { role: "user", content: "  " },
  ],
  call_analysis: { call_summary: "Needs AC repair.", user_sentiment: "Positive", custom_analysis_data: { outcome: "qualified", confidence: 0.86, urgency: "today_tomorrow" } },
  call_cost: { combined_cost: 12.5 },
  ...over,
});

describe("Retell call -> our call row", () => {
  it("keeps the AI's outcome, answers, summary, transcript and cost", () => {
    const r = callRowFromRetell(ended());
    expect(r).toMatchObject({
      status: "ended",
      outcome: "qualified",
      confidence: 0.86,
      duration_seconds: 95,
      summary: "Needs AC repair.",
      sentiment: "Positive",
      needs_review: false,
      cost_usd: 0.125,
      started_at: new Date(1_790_000_000_000).toISOString(),
    });
    expect(r.analysis).toMatchObject({ urgency: "today_tomorrow" });
    expect(r.transcript).toEqual([
      { role: "agent", content: "Hi Maria" },
      { role: "user", content: "Yes, the AC stopped." },
    ]);
  });

  it("uses how the call ended before what the AI said", () => {
    expect(deriveOutcome(ended({ disconnection_reason: "dial_no_answer", call_status: "not_connected", call_analysis: undefined }))).toBe("no_answer");
    expect(deriveOutcome(ended({ disconnection_reason: "voicemail_reached" }))).toBe("voicemail");
    expect(deriveOutcome(ended({ disconnection_reason: "call_transfer" }))).toBe("transferred");
    expect(deriveOutcome(ended({ disconnection_reason: "user_requested_dnc" }))).toBe("do_not_call");
    expect(deriveOutcome(ended({ disconnection_reason: "invalid_destination", call_status: "error" }))).toBe("other");
    expect(deriveOutcome(ended({ call_status: "ongoing" }))).toBeNull();
    expect(deriveOutcome(ended({ call_analysis: { custom_analysis_data: { outcome: "made_up" } } }))).toBe("other");
  });

  it("flags unsure, unclear and emergency calls for review, never no-answers", () => {
    expect(callRowFromRetell(ended({ call_analysis: { custom_analysis_data: { outcome: "qualified", confidence: 0.4 } } })).needs_review).toBe(true);
    expect(callRowFromRetell(ended({ call_analysis: { custom_analysis_data: { outcome: "callback", confidence: 0.9, emergency: true } } })).needs_review).toBe(true);
    expect(callRowFromRetell(ended({ call_analysis: { custom_analysis_data: {} } })).needs_review).toBe(true);
    expect(callRowFromRetell(ended({ disconnection_reason: "dial_no_answer", call_status: "not_connected", call_analysis: {} })).needs_review).toBe(false);
    // Before analysis arrives nothing is flagged yet.
    expect(callRowFromRetell(ended({ call_analysis: undefined })).needs_review).toBe(false);
  });

  it("moves the customer forward only", () => {
    expect(statusAfterCall("new", "qualified")).toBe("qualified");
    expect(statusAfterCall("contacted", "qualified")).toBe("qualified");
    expect(statusAfterCall("new", "callback")).toBe("contacted");
    expect(statusAfterCall("new", "no_answer")).toBeNull();
    expect(statusAfterCall("contacted", "not_interested")).toBeNull();
    expect(statusAfterCall("appointment", "qualified")).toBeNull();
    expect(statusAfterCall("won", "do_not_call")).toBeNull();
  });
});


describe("call answers shown in the app", () => {
  const questions = [
    { key: "system_type", question: "What type of system is it?", answer_type: "choice", required: true },
    { key: "custom_1", question: "Do you have pets?", answer_type: "text", required: false },
  ];
  it("labels answers with the business's questions, then the standard fields", () => {
    const rows = callAnswers(
      { outcome: "qualified", confidence: 0.9, answer_system_type: "Central air", answer_custom_1: "", service: "repair", urgency: "today_tomorrow", emergency: false, asked_for_human: true, preferred_window: "Monday morning" },
      questions,
      (v) => (v === "repair" ? "AC / Heating Repair" : v),
    );
    expect(rows).toEqual([
      { label: "What type of system is it?", value: "Central air" },
      { label: "Service", value: "AC / Heating Repair" },
      { label: "Urgency", value: "Today or tomorrow" },
      { label: "Preferred visit", value: "Monday morning" },
      { label: "Asked for a person", value: "Yes" },
    ]);
  });
  it("keeps answers to questions removed since the call, and hides unknowns", () => {
    expect(callAnswers({ answer_roof_age: "10 years", service: "unknown" }, [], (v) => v)).toEqual([{ label: "roof age", value: "10 years" }]);
  });
  it("describes calls without an outcome yet", () => {
    expect(outcomeLabel(null, "registered")).toBe("Calling...");
    expect(outcomeLabel(null, "error")).toBe("Call failed");
    expect(outcomeLabel("qualified", "ended")).toBe("Qualified");
  });
});

describe("incoming calls", () => {
  it("greets a known caller by name with what they asked about", () => {
    const v = inboundCallVariables("Cool Air HVAC", { full_name: "Maria Lopez", serviceLabel: "AC / Heating Repair", zip: "75201" });
    expect(v.opening).toBe("Thanks for calling Cool Air HVAC. This is the virtual assistant, and this call may be recorded. Am I speaking with Maria?");
    expect(v).toMatchObject({ lead_name: "Maria Lopez", lead_service: "ac / heating repair", lead_zip: "75201", known_caller: "yes" });
  });
  it("leaves unknown callers on the default greeting", () => {
    expect(inboundCallVariables("Cool Air HVAC", null)).toEqual({});
    expect(inboundCallVariables("Cool Air HVAC", { full_name: " ", serviceLabel: null, zip: null })).toEqual({});
  });
});

describe("calls where the caller chose a visit window", () => {
  const base = callRowFromRetell(ended());
  it("count as booked instead of qualified / callback / unclear", () => {
    expect(withBooking(base, true).outcome).toBe("booked");
    expect(withBooking({ ...base, outcome: "other", needs_review: true }, true)).toMatchObject({ outcome: "booked", needs_review: false });
    expect(withBooking(base, false).outcome).toBe("qualified");
  });
  it("never override no answer, transfer or do-not-call", () => {
    for (const o of ["no_answer", "transferred", "do_not_call", "voicemail"] as const) expect(withBooking({ ...base, outcome: o }, true).outcome).toBe(o);
  });
  it("still flags emergencies and low confidence for review", () => {
    expect(withBooking({ ...base, analysis: { emergency: true } }, true).needs_review).toBe(true);
    expect(withBooking({ ...base, confidence: 0.3 }, true).needs_review).toBe(true);
  });
});
