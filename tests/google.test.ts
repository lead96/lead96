import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  apiRowToLead,
  friendlyGoogleError,
  googleAdsError,
  googleWebhookSchema,
  microsToAmount,
  parseGoogleTime,
  resourceId,
  webhookToLead,
} from "@/lib/google/leads";
import { normalizeLead } from "@/lib/leads/normalize";

const key = randomBytes(32).toString("hex");

describe("stored secret encryption", () => {
  it("round-trips, and each encryption differs", () => {
    const a = encryptSecret("1//refresh-token", key);
    expect(decryptSecret(a, key)).toBe("1//refresh-token");
    expect(encryptSecret("1//refresh-token", key)).not.toBe(a);
    expect(a).not.toContain("refresh");
  });

  it("refuses a changed value or another key", () => {
    const a = encryptSecret("secret", key);
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(a, randomBytes(32).toString("hex"))).toThrow();
    expect(() => encryptSecret("x", "abcd")).toThrow(/64 hex/);
  });
});

// Shape from Google's lead form webhook documentation.
const webhook = {
  lead_id: "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEe",
  user_column_data: [
    { column_name: "Full Name", string_value: "Ana Ruiz", column_id: "FULL_NAME" },
    { column_name: "User Phone", string_value: "1-305-555-0123", column_id: "PHONE_NUMBER" },
    { column_name: "User Email", string_value: "Ana@Example.com", column_id: "EMAIL" },
    { column_name: "Postal Code", string_value: "33101", column_id: "POSTAL_CODE" },
    { column_name: "What do you need help with?", string_value: "AC not cooling", column_id: "SERVICE_QUESTION_1" },
  ],
  api_version: "1.0",
  form_id: 40000000000,
  campaign_id: 20000000000,
  google_key: "testkey",
  is_test: false,
  gcl_id: "Cj0KCQjw-test",
  adgroup_id: 20000000001,
  creative_id: 30000000000,
  lead_submit_time: "2026-10-09T14:02:11-04:00",
};

describe("Google lead form webhook", () => {
  it("maps contact fields, IDs and answers; dedups by click ID", () => {
    const lead = webhookToLead(googleWebhookSchema.parse(webhook), "ws-1");
    expect(lead).toMatchObject({
      source: "google",
      kind: "form",
      external_id: "gclid:Cj0KCQjw-test",
      full_name: "Ana Ruiz",
      phone: "1-305-555-0123",
      email: "Ana@Example.com",
      zip: "33101",
      campaign_id: "20000000000",
      adset_id: "20000000001",
      ad_id: "30000000000",
      form_id: "40000000000",
      gclid: "Cj0KCQjw-test",
      consent_given: false,
      received_at: "2026-10-09T18:02:11.000Z",
    });
    expect(lead.fields).toEqual({ what_do_you_need_help_with: "AC not cooling" });
    const n = normalizeLead(lead);
    expect(n.ok && n.lead).toMatchObject({ phone: "+13055550123", email: "ana@example.com", attribution_complete: true });
  });

  it("joins first + last name, falls back to the lead id without a click id", () => {
    const lead = webhookToLead(
      googleWebhookSchema.parse({
        lead_id: "L1",
        user_column_data: [
          { column_id: "FIRST_NAME", string_value: "Bob" },
          { column_id: "LAST_NAME", string_value: "Lee" },
          { column_id: "WORK_EMAIL", string_value: "bob@lee.com" },
        ],
      }),
      "ws-1",
    );
    expect(lead).toMatchObject({ full_name: "Bob Lee", email: "bob@lee.com", external_id: "lead:L1", gclid: null });
  });

  it("rejects bodies without a lead id", () => {
    expect(googleWebhookSchema.safeParse({ user_column_data: [] }).success).toBe(false);
  });
});

describe("Google Ads API lead rows", () => {
  const names = { campaigns: new Map([["111", "AC Repair Miami"]]), adGroups: new Map([["222", "Emergency"]]) };
  it("maps lead_form_submission_data (REST JSON) with campaign and ad group names", () => {
    const lead = apiRowToLead(
      {
        leadFormSubmissionData: {
          id: "s-9",
          campaign: "customers/123/campaigns/111",
          adGroup: "customers/123/adGroups/222",
          adGroupAd: "customers/123/adGroupAds/222~333",
          asset: "customers/123/assets/444",
          gclid: "Cj0KCQjw-test",
          submissionDateTime: "2026-10-09 14:02:11-04:00",
          leadFormSubmissionFields: [
            { fieldType: "FULL_NAME", fieldValue: "Ana Ruiz" },
            { fieldType: "PHONE_NUMBER", fieldValue: "+13055550123" },
          ],
          customLeadFormSubmissionFields: [{ questionText: "How soon do you need service?", fieldValue: "Today" }],
        },
      },
      "ws-1",
      names,
    );
    expect(lead).toMatchObject({
      external_id: "gclid:Cj0KCQjw-test", // same as the webhook → stored once
      campaign_id: "111",
      campaign_name: "AC Repair Miami",
      adset_id: "222",
      adset_name: "Emergency",
      ad_id: "333",
      form_id: "444",
      full_name: "Ana Ruiz",
      received_at: "2026-10-09T18:02:11.000Z",
    });
    expect(lead.fields).toEqual({ how_soon_do_you_need_service: "Today" });
  });

  it("helpers", () => {
    expect(resourceId("customers/1/adGroupAds/22~33")).toBe("33");
    expect(resourceId(undefined)).toBeNull();
    expect(parseGoogleTime("nope")).toBeNull();
    expect(microsToAmount("12345678")).toBe(12.35);
    expect(microsToAmount(undefined)).toBe(0);
  });

  it("turns API errors into plain messages", () => {
    const body = {
      error: {
        code: 403,
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
        details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is only approved for use with test accounts." }] }],
      },
    };
    const e = googleAdsError(body, 403);
    expect(e.code).toBe("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(friendlyGoogleError(e)).toContain("Basic access");
    expect(googleAdsError({}, 500)).toEqual({ code: "HTTP_500", message: "Google Ads API answered 500" });
  });
});
