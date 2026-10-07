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
