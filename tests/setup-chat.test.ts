import { describe, expect, it } from "vitest";
import { clampRadius, describeAreaResult, extractZipList, parseCityLabel } from "@/lib/setup/area";
import { emptyDraft, mergeUpdates } from "@/lib/setup/draft";
import { greetingPrompt, nextQuestion } from "@/lib/setup/questions";

const ctx = {
  businessName: "Cool Air",
  services: [
    { value: "repair", label: "Repair" },
    { value: "replacement", label: "Replacement" },
  ],
  customerTypes: [{ value: "homeowner", label: "Homeowner" }],
  defaultQuestions: ["ZIP?", "Own the home?"],
};

describe("extractZipList", () => {
  it("recognises pasted or uploaded ZIP lists", () => {
    expect(extractZipList("33101, 33102, 33109")).toEqual(["33101", "33102", "33109"]);
    expect(extractZipList("ZIP codes: 33101\n33102\n33109\n33110")).toHaveLength(4);
    expect(extractZipList("zip 33101 | 33102 | 33109 and 33110 here")).toHaveLength(4);
  });
  it("leaves sentences with a few ZIPs to the model", () => {
    expect(extractZipList("We mostly work in 33101 and 33102 but sometimes 33109 for big jobs")).toBeNull();
    expect(extractZipList("Miami, 20 miles")).toBeNull();
    expect(extractZipList("33101 33102")).toBeNull();
  });
});

describe("area helpers", () => {
  it("clamps the radius and falls back to the default", () => {
    expect(clampRadius(null)).toBe(15);
    expect(clampRadius(0.2)).toBe(1);
    expect(clampRadius(500)).toBe(60);
    expect(clampRadius(20.4)).toBe(20);
  });
  it("describes results and parses City, ST buttons", () => {
    expect(describeAreaResult(["33101", "33102", "33109", "33110"], "Miami, FL", 15)).toMatch(/^Found 4 ZIP codes within 15 miles of Miami, FL — e\.g\. 33101, 33102, 33109 and 1 more\./);
    expect(describeAreaResult(["33101"], "Miami, FL", 5)).toContain("Found 1 ZIP code within 5 miles");
    expect(parseCityLabel("Miami, FL")).toEqual({ city: "Miami", state: "FL" });
    expect(parseCityLabel("Miami")).toBeNull();
  });
});

describe("questions", () => {
  it("asks for missing fields in order, with buttons where answers are fixed", () => {
    const d = emptyDraft();
    const q1 = nextQuestion(d, ctx);
    expect(q1.options).toEqual(["Repair", "Replacement", "All services"]);
    expect(q1.allow_multiple).toBe(true);
    const d2 = mergeUpdates(d, { services: ["repair"] }, { services: ["repair", "replacement"], customerTypes: ["homeowner"] }).draft;
    expect(nextQuestion(d2, ctx).options).toEqual(["Phone calls", "Web forms", "Both"]);
    const d3 = { ...d2, lead_types: ["call" as const], customer_types: ["homeowner"] };
    expect(nextQuestion(d3, ctx).options).toBeUndefined(); // service area is free text
    expect(nextQuestion(d3, ctx).text).toContain("Miami, 20 miles");
  });
  it("ends with the save instruction and greets differently on update", () => {
    const full = {
      ...emptyDraft(),
      services: ["repair"], lead_types: ["call" as const], customer_types: ["homeowner"], zip_codes: ["33101"],
      booking_hours: { mon: [{ start: "08:00", end: "17:00" }] }, capacity_per_day: 4, monthly_budget: 1000,
      transfer_phone: "+12145550100", questions_confirmed: true,
    };
    expect(nextQuestion(full, ctx).text).toContain("Save setup");
    expect(greetingPrompt(ctx, true, full).options).toContain("Service area");
    expect(greetingPrompt(ctx, false, emptyDraft()).options).toContain("All services");
  });
});

describe("resolveButtonAnswer (button clicks skip the model)", async () => {
  const { resolveButtonAnswer, questionFor } = await import("@/lib/setup/questions");
  const d = emptyDraft();
  const ask = (field: Parameters<typeof questionFor>[0]) => questionFor(field, ctx);

  it("maps single- and multi-select labels to values", () => {
    expect(resolveButtonAnswer("Repair, Replacement", ask("services"), ctx, d)).toEqual({ kind: "updates", updates: { services: ["repair", "replacement"] } });
    expect(resolveButtonAnswer("Repair, All services", ask("services"), ctx, d)).toEqual({ kind: "updates", updates: { services: ["repair", "replacement"] } });
    expect(resolveButtonAnswer("All customers", ask("customer_types"), ctx, d)).toEqual({ kind: "updates", updates: { customer_types: ["homeowner"] } });
    expect(resolveButtonAnswer("Both", ask("lead_types"), ctx, d)).toEqual({ kind: "updates", updates: { lead_types: ["form", "call"] } });
    expect(resolveButtonAnswer("10+", ask("capacity_per_day"), ctx, d)).toEqual({ kind: "updates", updates: { capacity_per_day: 10 } });
    expect(resolveButtonAnswer("$2,000", ask("monthly_budget"), ctx, d)).toEqual({ kind: "updates", updates: { monthly_budget: 2000 } });
    const hours = resolveButtonAnswer("Mon–Sat 8am–6pm", ask("booking_hours"), ctx, d);
    expect(hours?.kind === "updates" && hours.updates.booking_hours).toHaveLength(6);
    expect(resolveButtonAnswer("Looks good", ask("questions_confirmed"), ctx, d)).toMatchObject({ kind: "updates", updates: { questions_confirmed: true } });
  });

  it("opens follow-up questions for 'other' buttons and update topics", () => {
    expect(resolveButtonAnswer("Other hours", ask("booking_hours"), ctx, d)).toMatchObject({ kind: "ask" });
    expect(resolveButtonAnswer("Add a question", ask("questions_confirmed"), ctx, d)).toMatchObject({ kind: "ask" });
    const update = { text: "What would you like to change?", options: ["Services", "Service area"] };
    expect(resolveButtonAnswer("Service area", update, ctx, d)).toMatchObject({ kind: "ask", prompt: { text: expect.stringContaining("Miami, 20 miles") } });
  });

  it("maps a City, ST pick to an area lookup", () => {
    const which = { text: "Which Springfield do you mean?", options: ["Springfield, IL", "Springfield, MA"], radius_miles: 10 };
    expect(resolveButtonAnswer("Springfield, MA", which, ctx, d)).toEqual({ kind: "area", city: "Springfield", state: "MA" });
  });

  it("leaves typed answers to the model", () => {
    expect(resolveButtonAnswer("repairs and installs", ask("services"), ctx, d)).toBeNull();
    expect(resolveButtonAnswer("Both, mostly calls", ask("lead_types"), ctx, d)).toBeNull();
    expect(resolveButtonAnswer("Miami, 20 miles", ask("zip_codes"), ctx, d)).toBeNull();
    expect(resolveButtonAnswer("3", ask("capacity_per_day"), ctx, d)).toBeNull();
  });
});

describe("compactDraft", async () => {
  const { compactDraft } = await import("@/lib/setup/prompts");
  it("drops empty fields and reduces the ZIP list to a count", () => {
    const zips = Array.from({ length: 138 }, (_, i) => String(33100 + i));
    expect(compactDraft({ ...emptyDraft(), services: ["repair"], zip_codes: zips })).toEqual({ services: ["repair"], service_area: "138 ZIP codes" });
    expect(compactDraft({ ...emptyDraft(), zip_codes: zips, area_description: "Miami, FL · 20 mi" }).service_area).toBe("Miami, FL · 20 mi");
  });
});

describe("normalizeAreaLookup", async () => {
  const { normalizeAreaLookup } = await import("@/lib/setup/area");
  const l = (city: string | null, state: string | null = null) => ({ city, state, center_zip: null, radius_miles: 20 });
  it("splits a state packed into the city field and drops filler words", () => {
    expect(normalizeAreaLookup(l("Miami, FL"))).toMatchObject({ city: "Miami", state: "FL" });
    expect(normalizeAreaLookup(l("Miami FL"))).toMatchObject({ city: "Miami", state: "FL" });
    expect(normalizeAreaLookup(l("around Miami"))).toMatchObject({ city: "Miami", state: null });
    expect(normalizeAreaLookup(l("Miami", "fl"))).toMatchObject({ city: "Miami", state: "FL" });
  });
  it("keeps real city names that end in two letters, and rejects bad states", () => {
    expect(normalizeAreaLookup(l("El Paso"))).toMatchObject({ city: "El Paso", state: null });
    expect(normalizeAreaLookup(l("Saint Paul"))).toMatchObject({ city: "Saint Paul" });
    expect(normalizeAreaLookup(l("Miami", "Florida"))).toMatchObject({ city: "Miami", state: null });
  });
});

describe("messageMentionsPlace", async () => {
  const { messageMentionsPlace } = await import("@/lib/setup/area");
  const l = (city: string | null, center_zip: string | null = null) => ({ city, state: null, center_zip, radius_miles: 20 });
  it("only accepts lookups for places named in the latest message", () => {
    expect(messageMentionsPlace("find me all zips around Miami, 20 miles", l("Miami"))).toBe(true);
    expect(messageMentionsPlace("(214) 555-0199", l("Miami"))).toBe(false);
    expect(messageMentionsPlace("15 miles from 33101", l(null, "33101"))).toBe(true);
  });
});

describe("pickDominantCity", async () => {
  const { pickDominantCity } = await import("@/lib/setup/area");
  const rows = (...counts: [string, number][]) => counts.map(([state, zip_count]) => ({ state, zip_count }));
  it("picks the obvious city and asks for genuinely ambiguous names (real ZIP counts)", () => {
    expect(pickDominantCity(rows(["FL", 95], ["OK", 2]))?.state).toBe("FL"); // Miami
    expect(pickDominantCity(rows(["OR", 60], ["ME", 9]))?.state).toBe("OR"); // Portland
    expect(pickDominantCity(rows(["IL", 35], ["MA", 19]))).toBeNull(); // Springfield
    expect(pickDominantCity(rows(["OH", 45], ["GA", 14]))).toBeNull(); // Columbus
    expect(pickDominantCity(rows(["MO", 71], ["KS", 15]))).toBeNull(); // Kansas City
    expect(pickDominantCity(rows(["TX", 105]))?.state).toBe("TX");
    expect(pickDominantCity([])).toBeNull();
  });
});
