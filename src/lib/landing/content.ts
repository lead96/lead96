/**
 * Landing page content: what the simple template editor edits and the templates render.
 * Pure — unit-tested. The four templates share one content shape; each uses what it needs.
 */
import { z } from "zod";

export const TEMPLATES = [
  { value: "call_first", label: "Call-first", description: "Big call button. Best when you want phone calls." },
  { value: "quote_form_call", label: "Quote form + call", description: "Short quote form with a call button next to it." },
  { value: "multi_step_quiz", label: "Multi-step quiz", description: "A few tap-to-answer questions, then contact details." },
  { value: "seasonal_offer", label: "Seasonal offer", description: "Headline offer (e.g. tune-up special) with a quick form." },
] as const;
export type TemplateKey = (typeof TEMPLATES)[number]["value"];

/** Shown next to every form. Bump the version whenever the wording changes; it is stored with each lead. */
export const CONSENT_VERSION = "2026-10-08";
export function consentText(businessName: string) {
  return `By submitting, I agree that ${businessName || "this business"} may call or text me at the number provided, including with automated or AI-assisted calls, about my request. Consent is not a condition of purchase. Message and data rates may apply.`;
}

const text = (max: number) => z.string().trim().max(max);

export const contentSchema = z.object({
  business_name: text(80).min(1, "Business name is required"),
  headline: text(90).min(1, "Headline is required"),
  subheadline: text(200),
  phone: text(20),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #3b82f6"),
  logo_url: z.union([z.literal(""), z.url().max(500)]),
  trust_points: z.array(text(60)).max(4),
  services: z.array(text(40)).max(8),
  service_area: text(100),
  cta_text: text(30).min(1, "Button text is required"),
  offer_title: text(60),
  offer_details: text(160),
  offer_expires: text(40),
});
export type LandingContent = z.infer<typeof contentSchema>;

export const DEFAULT_BRAND_COLOR = "#3b82f6";

export function defaultContent(template: TemplateKey, opts: { businessName: string; phone?: string | null; services?: string[]; serviceArea?: string | null }): LandingContent {
  const area = opts.serviceArea || "your area";
  return {
    business_name: opts.businessName,
    headline:
      template === "seasonal_offer"
        ? "Beat the heat — AC tune-up special"
        : template === "call_first"
          ? `Fast, reliable HVAC service in ${area}`
          : `Get a free HVAC quote in ${area}`,
    subheadline: "Licensed local technicians. Upfront pricing. Same-day appointments when available.",
    phone: opts.phone ?? "",
    brand_color: DEFAULT_BRAND_COLOR,
    logo_url: "",
    trust_points: ["Licensed & insured", "Upfront pricing", "Same-day service", "5-star local reviews"],
    services: (opts.services ?? []).slice(0, 8),
    service_area: opts.serviceArea ?? "",
    cta_text: template === "call_first" ? "Call now" : template === "seasonal_offer" ? "Claim my offer" : "Get my free quote",
    offer_title: template === "seasonal_offer" ? "$89 AC tune-up" : "",
    offer_details: template === "seasonal_offer" ? "21-point inspection and cleaning. New customers only." : "",
    offer_expires: template === "seasonal_offer" ? "Limited time" : "",
  };
}

/** Merge stored JSON with defaults so pages saved by an older version still render. */
export function readContent(stored: unknown, fallback: LandingContent): LandingContent {
  const merged = { ...fallback, ...(typeof stored === "object" && stored ? stored : {}) };
  const parsed = contentSchema.safeParse(merged);
  return parsed.success ? parsed.data : fallback;
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** "Cool Air HVAC — Miami!" → "cool-air-hvac-miami" (3–60 chars, matches the DB check). */
export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : `${s || "page"}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Hex color → readable text color on top of it. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0f172a" : "#ffffff";
}
