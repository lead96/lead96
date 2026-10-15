import { z } from "zod";
import { normalizeUsPhone } from "@/lib/setup/draft";

/**
 * US texting registration (A2P 10DLC) per business: the contractor's own details, which a Lead96
 * admin copies into Retell (business profile, brand, campaign). Shared by Settings and Admin.
 */

export const BUSINESS_TYPES = {
  llc: "LLC",
  corporation: "Corporation",
  partnership: "Partnership",
  sole_proprietor: "Sole proprietor",
  non_profit: "Non-profit",
} as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;

export type TextingStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected";
export const STATUS_LABELS: Record<TextingStatus, { label: string; tone: "slate" | "blue" | "green" | "red" | "amber" }> = {
  draft: { label: "Not sent yet", tone: "slate" },
  submitted: { label: "Sent to Lead96", tone: "blue" },
  in_review: { label: "Carrier review", tone: "blue" },
  approved: { label: "Texting approved", tone: "green" },
  rejected: { label: "Needs changes", tone: "amber" },
};

export const US_STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );

export const FIELDS = [
  "legal_name",
  "brand_name",
  "business_type",
  "ein",
  "website",
  "street",
  "city",
  "state",
  "zip",
  "contact_first_name",
  "contact_last_name",
  "contact_title",
  "contact_email",
  "contact_phone",
] as const;
export type Registration = Record<(typeof FIELDS)[number], string>;

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max, message);

/** "12 3456789", "123456789" -> "12-3456789". */
export function normalizeEin(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 9 && !/^0{2}/.test(digits) ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
}

/** "acme.com" -> "https://acme.com". Only http(s) URLs with a dotted host. */
export function normalizeWebsite(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export const registrationSchema = z.object({
  legal_name: text(2, 120, "Enter the legal business name, exactly as on the IRS letter (EIN)"),
  brand_name: z.string().trim().max(120).optional().default(""),
  business_type: z.enum(Object.keys(BUSINESS_TYPES) as [BusinessType, ...BusinessType[]], "Choose the business type"),
  ein: z.string().transform((v, ctx) => normalizeEin(v) ?? (ctx.addIssue({ code: "custom", message: "EIN must be 9 digits, like 12-3456789" }), z.NEVER)),
  website: z.string().transform((v, ctx) => normalizeWebsite(v) ?? (ctx.addIssue({ code: "custom", message: "Enter the business website, like acmehvac.com" }), z.NEVER)),
  street: text(3, 160, "Enter the street address"),
  city: text(2, 80, "Enter the city"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => US_STATES.includes(s), "Choose the state"),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "ZIP must be 5 digits"),
  contact_first_name: text(1, 60, "Enter the contact's first name"),
  contact_last_name: text(1, 60, "Enter the contact's last name"),
  contact_title: text(2, 60, "Enter the contact's job title, like Owner"),
  contact_email: z.email("Enter a valid contact email").max(200),
  contact_phone: z.string().transform((v, ctx) => normalizeUsPhone(v) ?? (ctx.addIssue({ code: "custom", message: "Enter a 10-digit US phone number" }), z.NEVER)),
});

/** Validates the form; returns the cleaned values or the first error. */
export function parseRegistration(input: Partial<Registration>) {
  const r = registrationSchema.safeParse(input);
  return r.success ? ({ ok: true, data: r.data } as const) : ({ ok: false, error: r.error.issues[0].message } as const);
}

/**
 * Ready-to-paste campaign fields for Retell, written for this contractor (the contractor is the
 * brand; Lead96 is only the software). Kept in line with the real texts and the form's consent box.
 */
export function campaignText(p: { brand: string; legalName: string; formUrl: string; consent: string }) {
  const brand = p.brand.trim() || p.legalName.trim();
  const dba = p.brand.trim() && p.brand.trim() !== p.legalName.trim() ? `${p.legalName.trim()}, doing business as ${brand}` : brand;
  return {
    useCase: "Low Volume Mixed",
    description: `${dba} is a home-service contractor. It uses an automated AI phone assistant (software by Lead96) to follow up on service requests. We text only people who asked us for service through our web form at ${p.formUrl} and ticked the optional consent box. Messages are about their own request: a follow-up after we could not reach them by phone, questions about the job, and scheduling, confirmations and reminders for their appointment. People can reply; replies are answered by the automated assistant and our team. Message frequency varies (usually a few messages per request). Reply STOP to opt out, HELP for help.`,
    sample1: `Hi Maria, this is ${brand}. We just tried to call about your AC repair request. Reply here with a good time for a visit. Reply STOP to opt out.`,
    sample2: `${brand}: your visit is set for Thu Oct 15, 8am-12pm at 1200 Main St. Reply here to change it. Reply STOP to opt out, HELP for help.`,
    optIn: `People request service on our web form at ${p.formUrl}. Under the form there is an optional checkbox, unchecked by default; the form can be sent without it. The checkbox text reads: "${p.consent}" with links to https://lead96.com/privacy and https://lead96.com/terms. Each consent is stored with the exact text, version, time, page, IP address and browser. Only people who ticked the box receive texts; people who reply STOP are never texted or called again.`,
    privacyUrl: "https://lead96.com/privacy",
    termsUrl: "https://lead96.com/terms#sms",
  };
}
