import { describe, expect, it } from "vitest";
import {
  describeHours,
  draftFromSaved,
  emptyDraft,
  mergeUpdates,
  missingFields,
  normalizeHours,
  normalizeUsPhone,
  parseZips,
  questionsFromDraft,
} from "@/lib/setup/draft";

const vocab = {
  services: ["repair", "replacement", "installation", "maintenance"],
  customerTypes: ["homeowner", "commercial"],
};

describe("validation helpers", () => {
  it("parses ZIPs from free text, dedupes, trims ZIP+4", () => {
    expect(parseZips("75201, 75204 and 75201-1234; 7520 or 123456")).toEqual(["75201", "75204"]);
    expect(parseZips(["75201", "Dallas"])).toEqual(["75201"]);
  });

  it("normalizes US phones and rejects invalid ones", () => {
    expect(normalizeUsPhone("(214) 555-0100")).toBe("+12145550100");
    expect(normalizeUsPhone("+1 214 555 0100")).toBe("+12145550100");
    expect(normalizeUsPhone("555-0100")).toBeNull();
    expect(normalizeUsPhone("014 555 0100")).toBeNull();
  });

  it("keeps only valid hour ranges", () => {
    expect(
      normalizeHours([
        { day: "Monday", start: "08:00", end: "17:00" },
        { day: "tue", start: "17:00", end: "08:00" },
        { day: "funday", start: "08:00", end: "09:00" },
        { day: "wed", start: "8am", end: "5pm" },
      ]),
    ).toEqual({ mon: [{ start: "08:00", end: "17:00" }] });
  });

  it("describes hours compactly", () => {
    const h = normalizeHours(
      ["mon", "tue", "wed", "thu", "fri"].map((day) => ({ day, start: "08:00", end: "17:00" })).concat({ day: "sat", start: "09:00", end: "13:00" }),
    );
    expect(describeHours(h)).toBe("Mon-Fri 08:00-17:00; Sat 09:00-13:00");
  });
});

describe("mergeUpdates", () => {
  it("applies valid values and reports rejected ones without storing them", () => {
    const { draft, rejected } = mergeUpdates(
      emptyDraft(),
      {
        services: ["repair", "pool cleaning"],
        zip_codes: ["75201", "Dallas"],
        capacity_per_day: 5,
        monthly_budget: -10,
        transfer_phone: "12345",
        lead_types: ["call"],
      },
      vocab,
    );
    expect(draft.services).toEqual(["repair"]);
    expect(draft.zip_codes).toEqual(["75201"]);
    expect(draft.capacity_per_day).toBe(5);
    expect(draft.monthly_budget).toBeNull();
    expect(draft.transfer_phone).toBeNull();
    expect(draft.lead_types).toEqual(["call"]);
    expect(rejected.join(" | ")).toMatch(/pool cleaning.*monthly_budget.*transfer_phone/);
  });

  it("null means 'no change'; a fully invalid list does not wipe the old value", () => {
    const start = { ...emptyDraft(), services: ["repair"], zip_codes: ["75201"] };
    const { draft } = mergeUpdates(start, { services: null, zip_codes: ["nowhere"] }, vocab);
    expect(draft.services).toEqual(["repair"]);
    expect(draft.zip_codes).toEqual(["75201"]);
  });

  it("adding your own call questions counts as confirming the question list", () => {
    expect(mergeUpdates(emptyDraft(), { extra_questions: ["Is the unit on the roof?"] }, vocab).draft.questions_confirmed).toBe(true);
    expect(mergeUpdates(emptyDraft(), { notes: "hi" }, vocab).draft.questions_confirmed).toBe(false);
  });

  it("does not mutate the input draft", () => {
    const start = emptyDraft();
    mergeUpdates(start, { services: ["repair"] }, vocab);
    expect(start.services).toEqual([]);
  });
});

describe("missingFields", () => {
  it("lists everything for an empty draft and nothing for a complete one", () => {
    expect(missingFields(emptyDraft())).toHaveLength(9);
    const complete = mergeUpdates(
      emptyDraft(),
      {
        services: ["repair"],
        lead_types: ["form", "call"],
        customer_types: ["homeowner"],
        zip_codes: ["75201"],
        booking_hours: [{ day: "mon", start: "08:00", end: "17:00" }],
        capacity_per_day: 4,
        monthly_budget: 1500,
        transfer_phone: "214-555-0100",
        questions_confirmed: true,
      },
      vocab,
    ).draft;
    expect(missingFields(complete)).toEqual([]);
  });
});

describe("questions and saved data", () => {
  const defaults = [{ key: "zip_code", question: "ZIP?", answer_type: "text", required: true }];

  it("appends the owner's questions after the defaults and replaces old custom ones", () => {
    const first = questionsFromDraft(defaults, { ...emptyDraft(), extra_questions: ["Is the unit on the roof?"] });
    expect(first.map((q) => q.key)).toEqual(["zip_code", "custom_1"]);
    const second = questionsFromDraft(first, { ...emptyDraft(), extra_questions: ["Gas or electric?", "Any pets?"] });
    expect(second.map((q) => q.question)).toEqual(["ZIP?", "Gas or electric?", "Any pets?"]);
  });

  it("rebuilds a draft from saved rows (numeric strings from Postgres included)", () => {
    const d = draftFromSaved(
      { services: ["repair"], lead_types: ["call", "sms"], monthly_budget: "1500.00" as unknown as number, capacity_per_day: 3 },
      { questions: [...defaults, { key: "custom_1", question: "Roof unit?", answer_type: "text", required: false }], transfer_phone: "+12145550100" },
    );
    expect(d.lead_types).toEqual(["call"]);
    expect(d.monthly_budget).toBe(1500);
    expect(d.extra_questions).toEqual(["Roof unit?"]);
    expect(d.questions_confirmed).toBe(true);
  });
});

describe("campaign plan post-processing", async () => {
  const { buildPlan, normalizeShares } = await import("@/lib/setup/plan");
  const base = { ...emptyDraft(), lead_types: ["form", "call"] as ("form" | "call")[], monthly_budget: 1000, zip_codes: ["75201"] };
  const out = {
    summary: " Start with search. ",
    channels: [
      { channel: "google_search", share_percent: 70, reason: "a" },
      { channel: "meta_lead_ads", share_percent: 50, reason: "b" },
      { channel: "tiktok", share_percent: 30, reason: "c" },
      { channel: "google_search", share_percent: 10, reason: "dup" },
    ],
    landing_page_template: "nonsense",
    template_reason: "x",
    targeting_notes: "y",
    first_steps: ["one", " ", "two"],
  };

  it("shares always sum to 100", () => {
    for (const s of [[70, 50], [33, 33, 33], [0, 0], [1, 1, 1], [-5, 10]]) {
      expect(normalizeShares(s).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("drops unknown/duplicate channels, computes amounts in code, falls back to a valid template", () => {
    const { summary, plan } = buildPlan(out, base);
    expect(summary).toBe("Start with search.");
    expect(plan.channels.map((c) => [c.channel, c.share_percent, c.monthly_amount])).toEqual([
      ["google_search", 58, 580],
      ["meta_lead_ads", 42, 420],
    ]);
    expect(plan.landing_page_template).toBe("quote_form_call");
    expect(plan.first_steps).toEqual(["one", "two"]);
    expect(plan.budget.daily).toBeCloseTo(32.89, 2);
    expect(plan.service_area_zip_codes).toEqual(["75201"]);
  });

  it("enforces lead-type rules even if the model ignores them", () => {
    const callsOnly = buildPlan(out, { ...base, lead_types: ["call"] }).plan;
    expect(callsOnly.channels.map((c) => c.channel)).toEqual(["google_search"]);
    const formsOnly = buildPlan({ ...out, channels: [{ channel: "google_call_ads", share_percent: 100, reason: "" }] }, { ...base, lead_types: ["form"] }).plan;
    expect(formsOnly.channels.map((c) => c.channel)).toEqual(["google_search"]);
  });
});

describe("formatUsPhone", () => {
  it("formats stored E.164 numbers for display", async () => {
    const { formatUsPhone } = await import("@/lib/setup/draft");
    expect(formatUsPhone("+12145550199")).toBe("(214) 555-0199");
    expect(formatUsPhone(null)).toBe("");
  });
});
