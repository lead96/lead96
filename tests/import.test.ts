import { describe, expect, it } from "vitest";
import { guessMapping, mapRows, matchService, parseCsv, parseLeadDate, rowProblem } from "@/lib/leads/csv";
import { hasAttribution, normalizeLead } from "@/lib/leads/normalize";
import { callPayloadSchema, callToLead, formatDuration } from "@/lib/intake/call";
import { sign, verify } from "@/lib/intake/signature";

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, line breaks inside quotes, CRLF, a BOM and blank lines", () => {
    const csv = '﻿Name,Phone,Notes\r\n"Ruiz, Ana",305-555-0101,"Said ""ASAP""\nback door"\r\n\r\nBob,3055550102,\n';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Phone", "Notes"],
      ["Ruiz, Ana", "305-555-0101", 'Said "ASAP"\nback door'],
      ["Bob", "3055550102", ""],
    ]);
  });

  it("detects semicolon and tab separated files", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("column mapping", () => {
  it("guesses common export headers and keeps the rest as extra info", () => {
    expect(guessMapping(["First Name", "Last Name", "Phone Number", "Email Address", "Zip Code", "Service Date", "Job Type", "Notes", "Lead Status"])).toEqual([
      "first_name",
      "last_name",
      "phone",
      "email",
      "zip",
      "received_at",
      "service",
      "message",
      "extra",
    ]);
    expect(guessMapping(["Name", "utm_source", "utm_campaign", "Campaign", "Mobile", "Phone"])).toEqual([
      "full_name",
      "utm_source",
      "utm_campaign",
      "campaign_name",
      "phone",
      "extra", // a second phone column is not guessed over the first
    ]);
  });

  it("maps rows: joins first + last name, keeps extra columns, parses dates in the business time zone", () => {
    const headers = ["First", "Last", "Phone", "Date", "Address", "Ignore me"];
    const rows = mapRows(headers, [["Ana", "Ruiz", "305-555-0101", "9/1/2026 9:30 AM", "1 Main St", "x"]], ["first_name", "last_name", "phone", "received_at", "extra", "skip"], "America/New_York");
    expect(rows).toEqual([
      { row: 2, full_name: "Ana Ruiz", phone: "305-555-0101", received_at: "2026-09-01T13:30:00.000Z", fields: { address: "1 Main St" } },
    ]);
  });

  it("explains rows that can't be imported", () => {
    expect(rowProblem({ row: 2, phone: "305-555-0101" })).toBeNull();
    expect(rowProblem({ row: 2, email: "a@b.co" })).toBeNull();
    expect(rowProblem({ row: 2, phone: "12345", email: "nope" })).toBe("Phone and email are not valid");
    expect(rowProblem({ row: 2, full_name: "No Contact" })).toBe("No phone or email");
  });

  it("matches service text to the HVAC services, keeping unknown text as is", () => {
    const services = [{ value: "ac_repair", label: "AC Repair" }];
    expect(matchService("ac repair", services)).toBe("ac_repair");
    expect(matchService("AC_REPAIR", services)).toBe("ac_repair");
    expect(matchService("Duct cleaning", services)).toBe("Duct cleaning");
    expect(matchService(undefined, services)).toBeUndefined();
  });

  it("campaign names from a file count as source data", () => {
    expect(hasAttribution({ workspace_id: "w", kind: "form", source: "csv", campaign_name: "Spring tune-up" })).toBe(true);
  });
});

describe("lead dates", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const tz = "America/Chicago";
  it("reads US and ISO formats in the business time zone, across DST", () => {
    expect(parseLeadDate("10/1/2026 2:15 PM", tz, now)).toBe("2026-10-01T19:15:00.000Z"); // CDT, UTC-5
    expect(parseLeadDate("1/15/26 08:00", tz, now)).toBe("2026-01-15T14:00:00.000Z"); // CST, UTC-6
    expect(parseLeadDate("2026-03-02", tz, now)).toBe("2026-03-02T18:00:00.000Z"); // date only → midday
    expect(parseLeadDate("2026-09-01T10:00:00Z", tz, now)).toBe("2026-09-01T10:00:00.000Z");
    expect(parseLeadDate("12/31/2025 12:00 AM", tz, now)).toBe("2025-12-31T06:00:00.000Z");
  });

  it("rejects impossible, ancient and future dates", () => {
    for (const bad of ["2/30/2026", "13/1/2026", "1/1/1999", "12/1/2026", "yesterday", "", "10/1/2026 13:00 PM"]) {
      expect(parseLeadDate(bad, tz, now)).toBeNull();
    }
  });
});

describe("intake signatures", () => {
  const secret = "s".repeat(40);
  const body = '{"call_id":"CA1"}';
  const now = 1_790_000_000_000;
  const ts = String(now / 1000);

  it("accepts a correct, fresh signature (also one of several during secret rotation)", () => {
    expect(verify({ secret, body, timestamp: ts, signature: sign(secret, ts, body), now })).toEqual({ ok: true });
    expect(verify({ secret, body, timestamp: ts, signature: `${sign("old".repeat(12), ts, body)},${sign(secret, ts, body)}`, now }).ok).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, old timestamps and missing headers", () => {
    expect(verify({ secret, body: '{"call_id":"CA2"}', timestamp: ts, signature: sign(secret, ts, body), now })).toEqual({ ok: false, reason: "invalid_signature" });
    expect(verify({ secret, body, timestamp: ts, signature: sign("x".repeat(40), ts, body), now }).ok).toBe(false);
    const old = String(now / 1000 - 600);
    expect(verify({ secret, body, timestamp: old, signature: sign(secret, old, body), now })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(verify({ secret, body, timestamp: null, signature: null, now })).toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("call intake payload", () => {
  const base = {
    call_id: "CA123",
    workspace_id: "6f1c1e1a-1111-4222-8333-944445555666",
    from: "(305) 555-0142",
    to: "+13055550100",
    started_at: "2026-10-08T14:00:00-04:00",
    duration_seconds: 154,
    status: "completed",
    answered_by: "ai",
    summary: "AC not cooling",
    answers: { urgency: "today", call_status: "spoofed" },
  };

  it("becomes a call lead with call details, keyed by call id", () => {
    const lead = callToLead(callPayloadSchema.parse(base));
    expect(lead).toMatchObject({ kind: "call", source: "call", external_id: "call_CA123", phone: "(305) 555-0142", message: "AC not cooling", received_at: base.started_at });
    expect(lead.fields).toEqual({ urgency: "today", call_status: "completed", duration_seconds: 154, answered_by: "ai", dialed_number: "+13055550100" });
    const n = normalizeLead(lead);
    expect(n.ok && n.lead.phone).toBe("+13055550142");
    expect(n.ok && n.lead.attribution_complete).toBe(false);
  });

  it("uses the tracking number's source when known", () => {
    const lead = callToLead(callPayloadSchema.parse({ ...base, tracking: { source: "google", campaign_id: "123", keyword: "ac repair near me" } }));
    expect(lead).toMatchObject({ source: "google", campaign_id: "123", keyword: "ac repair near me" });
    expect(callToLead(callPayloadSchema.parse({ ...base, tracking: { source: "other" } })).source).toBe("call");
  });

  it("rejects malformed payloads", () => {
    expect(callPayloadSchema.safeParse({ ...base, workspace_id: "nope" }).success).toBe(false);
    expect(callPayloadSchema.safeParse({ ...base, started_at: "yesterday" }).success).toBe(false);
    expect(callPayloadSchema.safeParse({ ...base, status: "weird" }).success).toBe(false);
    expect(callPayloadSchema.safeParse({ ...base, recording_url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("formats durations", () => {
    expect([formatDuration(42), formatDuration(120), formatDuration(154)]).toEqual(["42s", "2m", "2m 34s"]);
  });
});
