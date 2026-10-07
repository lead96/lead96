import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, contentSchema, defaultContent, readContent, slugify, textOn } from "@/lib/landing/content";
import { hasAttribution, normalizeLead } from "@/lib/leads/normalize";

describe("landing page content", () => {
  it("slugify makes valid, readable web addresses", () => {
    expect(slugify("Cool Air HVAC — Miami!")).toBe("cool-air-hvac-miami");
    expect(slugify("Smith & Sons Heating")).toBe("smith-and-sons-heating");
    expect(slugify("Café Climat")).toBe("cafe-climat");
    expect(SLUG_PATTERN.test(slugify("A"))).toBe(true); // padded to a valid length
    expect(SLUG_PATTERN.test(slugify("x".repeat(100)))).toBe(true);
  });

  it("defaults are valid for every template and use the business details", () => {
    for (const t of ["call_first", "quote_form_call", "multi_step_quiz", "seasonal_offer"] as const) {
      const c = defaultContent(t, { businessName: "Cool Air", phone: "(305) 555-0100", services: ["AC Repair"], serviceArea: "Miami, FL" });
      expect(contentSchema.safeParse(c).success).toBe(true);
      expect(c.business_name).toBe("Cool Air");
    }
    expect(defaultContent("call_first", { businessName: "X", serviceArea: "Miami, FL" }).headline).toContain("Miami, FL");
    expect(defaultContent("seasonal_offer", { businessName: "X" }).offer_title).not.toBe("");
  });

  it("readContent fills fields missing from older saved pages and rejects bad data", () => {
    const fallback = defaultContent("quote_form_call", { businessName: "Cool Air" });
    expect(readContent({ headline: "New headline" }, fallback).headline).toBe("New headline");
    expect(readContent({ headline: "New headline" }, fallback).trust_points).toEqual(fallback.trust_points);
    expect(readContent({ brand_color: "red" }, fallback)).toEqual(fallback);
    expect(readContent(null, fallback)).toEqual(fallback);
  });

  it("picks readable text on brand colors", () => {
    expect(textOn("#3b82f6")).toBe("#ffffff");
    expect(textOn("#fde047")).toBe("#0f172a");
  });
});

describe("lead normalization", () => {
  const base = { workspace_id: "w", kind: "form" as const, source: "landing_page" as const };
  it("normalizes phone, email and ZIP, and requires a way to contact", () => {
    const r = normalizeLead({ ...base, phone: "(305) 555-0101", email: " Ana@Example.COM ", zip: "33101-1234", full_name: "  Ana   Ruiz " });
    expect(r.ok && r.lead).toMatchObject({ phone: "+13055550101", email: "ana@example.com", zip: "33101", full_name: "Ana Ruiz" });
    expect(normalizeLead({ ...base, phone: "555", email: "not-an-email" })).toEqual({ ok: false, error: expect.stringContaining("phone number or email") });
    expect(normalizeLead({ ...base, email: "a@b.co" }).ok).toBe(true);
  });

  it("flags missing source data instead of inventing it", () => {
    expect(hasAttribution({ ...base })).toBe(false);
    expect(hasAttribution({ ...base, utm_source: "google" })).toBe(true);
    expect(hasAttribution({ ...base, gclid: "x" })).toBe(true);
    expect(hasAttribution({ ...base, source: "meta" })).toBe(false);
    expect(hasAttribution({ ...base, source: "meta", form_id: "f1" })).toBe(true);
  });
});
