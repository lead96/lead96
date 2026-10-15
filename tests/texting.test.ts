import { describe, expect, it } from "vitest";
import { consentText } from "@/lib/landing/content";
import { campaignText, normalizeEin, normalizeWebsite, parseRegistration } from "@/lib/texting/registration";

const valid = {
  legal_name: "Cool Air Services LLC",
  brand_name: "Cool Air HVAC",
  business_type: "llc",
  ein: "12 3456789",
  website: "coolairhvac.com",
  street: "1200 Main St",
  city: "Dallas",
  state: "tx",
  zip: "75201",
  contact_first_name: "Ann",
  contact_last_name: "Lee",
  contact_title: "Owner",
  contact_email: "ann@coolairhvac.com",
  contact_phone: "(214) 555-0100",
};

describe("texting registration", () => {
  it("cleans EINs, websites and phones", () => {
    expect(normalizeEin("123456789")).toBe("12-3456789");
    expect(normalizeEin("12-345678")).toBeNull();
    expect(normalizeEin("00-1234567")).toBeNull();
    expect(normalizeWebsite("acme.com")).toBe("https://acme.com");
    expect(normalizeWebsite("https://www.acme.com/")).toBe("https://www.acme.com");
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("acme")).toBeNull();
    const r = parseRegistration(valid);
    expect(r.ok && r.data).toMatchObject({ ein: "12-3456789", website: "https://coolairhvac.com", state: "TX", contact_phone: "+12145550100" });
  });

  it("names the first problem in plain words", () => {
    expect(parseRegistration({ ...valid, ein: "12" })).toEqual({ ok: false, error: "EIN must be 9 digits, like 12-3456789" });
    expect(parseRegistration({ ...valid, state: "XX" })).toEqual({ ok: false, error: "Choose the state" });
    expect(parseRegistration({ ...valid, contact_phone: "123" })).toEqual({ ok: false, error: "Enter a 10-digit US phone number" });
  });

  it("campaign text names the contractor as the brand and fits Retell's limits", () => {
    const c = campaignText({ brand: "Cool Air HVAC", legalName: "Cool Air Services LLC", formUrl: "https://lead96.com/p/cool-air-hvac", consent: consentText("Cool Air HVAC") });
    expect(c.description).toMatch(/^Cool Air Services LLC, doing business as Cool Air HVAC/);
    expect(c.description).toContain("https://lead96.com/p/cool-air-hvac");
    expect(c.description.length).toBeLessThanOrEqual(1000);
    expect(c.optIn.length).toBeLessThanOrEqual(2048);
    expect(c.optIn).toContain("I agree that Cool Air HVAC may call and text me");
    for (const t of [c.sample1, c.sample2]) expect(t).toMatch(/Reply STOP to opt out/);
    expect(c.sample1).toContain("this is Cool Air HVAC");
    // No dashes or curly quotes in anything we paste.
    expect(JSON.stringify(c)).not.toMatch(/[–—‘’“”…]/);
  });
});
