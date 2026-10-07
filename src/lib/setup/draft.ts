/**
 * The setup "draft": what we know about a business's demand while the setup chat runs.
 * Pure functions only (no I/O) so they can be unit-tested. Every value the AI extracts
 * passes through here; anything that fails validation is dropped, never stored.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

export const LEAD_TYPES = ["form", "call"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export type TimeRange = { start: string; end: string };
export type BookingHours = Partial<Record<Weekday, TimeRange[]>>;

export type SetupDraft = {
  services: string[];
  lead_types: LeadType[];
  customer_types: string[];
  zip_codes: string[];
  booking_hours: BookingHours;
  capacity_per_day: number | null;
  appointment_minutes: number | null;
  monthly_budget: number | null;
  target_cost_per_appointment: number | null;
  transfer_phone: string | null;
  extra_questions: string[];
  questions_confirmed: boolean;
  notes: string | null;
  /** How the area was described, e.g. "Miami, FL · 15 mi" (display only). */
  area_description: string | null;
};

export function emptyDraft(): SetupDraft {
  return {
    services: [],
    lead_types: [],
    customer_types: [],
    zip_codes: [],
    booking_hours: {},
    capacity_per_day: null,
    appointment_minutes: null,
    monthly_budget: null,
    target_cost_per_appointment: null,
    transfer_phone: null,
    extra_questions: [],
    questions_confirmed: false,
    notes: null,
    area_description: null,
  };
}

/** Fields the chat must collect before setup can be saved, in the order it should ask. */
export const REQUIRED_FIELDS = [
  { key: "services", label: "Services you offer" },
  { key: "lead_types", label: "Calls, forms or both" },
  { key: "customer_types", label: "Type of customers" },
  { key: "zip_codes", label: "Service area (ZIP codes)" },
  { key: "booking_hours", label: "Booking hours" },
  { key: "capacity_per_day", label: "Jobs you can take per day" },
  { key: "monthly_budget", label: "Monthly ad budget" },
  { key: "transfer_phone", label: "Phone for live transfers" },
  { key: "questions_confirmed", label: "AI call questions" },
] as const satisfies readonly { key: keyof SetupDraft; label: string }[];

export type RequiredField = (typeof REQUIRED_FIELDS)[number]["key"];

export function missingFields(d: SetupDraft): RequiredField[] {
  return REQUIRED_FIELDS.map((f) => f.key).filter((key) => {
    const v = d[key];
    if (Array.isArray(v)) return v.length === 0;
    if (key === "booking_hours") return Object.keys(d.booking_hours).length === 0;
    if (key === "questions_confirmed") return !d.questions_confirmed;
    return v === null;
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** 5-digit US ZIPs (ZIP+4 is cut to 5), de-duplicated, in input order. */
export function parseZips(input: string | string[]): string[] {
  const text = Array.isArray(input) ? input.join(" ") : input;
  const found = text.match(/\b\d{5}(?:-\d{4})?\b/g) ?? [];
  return [...new Set(found.map((z) => z.slice(0, 5)))];
}

/** US phone → E.164 (+1XXXXXXXXXX), or null if it isn't a valid 10-digit US number. */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10 || /^[01]/.test(national)) return null;
  return `+1${national}`;
}

/** +12145550199 → (214) 555-0199 for display. Anything else is shown unchanged. */
export function formatUsPhone(e164: string | null): string {
  const m = e164?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeHours(ranges: { day: string; start: string; end: string }[]): BookingHours {
  const out: BookingHours = {};
  for (const r of ranges) {
    const day = r.day.toLowerCase().slice(0, 3) as Weekday;
    if (!WEEKDAYS.includes(day) || !TIME.test(r.start) || !TIME.test(r.end) || r.start >= r.end) continue;
    (out[day] ??= []).push({ start: r.start, end: r.end });
  }
  for (const day of Object.keys(out) as Weekday[]) out[day]!.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

function intInRange(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;
}

function moneyInRange(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null;
}

function cleanText(v: string, max: number) {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Merging AI-extracted updates
// ---------------------------------------------------------------------------

/** What the model may send each turn. `null` = no change. Lists replace the previous list. */
export type DraftUpdates = {
  services: string[] | null;
  lead_types: string[] | null;
  customer_types: string[] | null;
  zip_codes: string[] | null;
  booking_hours: { day: string; start: string; end: string }[] | null;
  capacity_per_day: number | null;
  appointment_minutes: number | null;
  monthly_budget: number | null;
  target_cost_per_appointment: number | null;
  transfer_phone: string | null;
  extra_questions: string[] | null;
  questions_confirmed: boolean | null;
  notes: string | null;
};

export type Vocabulary = { services: string[]; customerTypes: string[] };

/**
 * Apply model-extracted updates to the draft. Returns the new draft and a list of
 * human-readable problems for values that were rejected (fed back to the model).
 */
export function mergeUpdates(
  draft: SetupDraft,
  u: Partial<DraftUpdates>,
  vocab: Vocabulary,
): { draft: SetupDraft; rejected: string[] } {
  const next: SetupDraft = structuredClone(draft);
  const rejected: string[] = [];

  const pickList = (values: string[] | null | undefined, allowed: readonly string[], field: string) => {
    if (!values) return null;
    const ok = [...new Set(values.filter((v) => allowed.includes(v)))];
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length) rejected.push(`${field}: unknown value(s) ${bad.join(", ")}`);
    return ok.length ? ok : null;
  };

  const services = pickList(u.services, vocab.services, "services");
  if (services) next.services = services;
  const leadTypes = pickList(u.lead_types, LEAD_TYPES, "lead_types");
  if (leadTypes) next.lead_types = leadTypes as LeadType[];
  const customerTypes = pickList(u.customer_types, vocab.customerTypes, "customer_types");
  if (customerTypes) next.customer_types = customerTypes;

  if (u.zip_codes) {
    const zips = parseZips(u.zip_codes);
    if (zips.length) next.zip_codes = zips;
    else rejected.push("zip_codes: no valid 5-digit ZIP codes");
  }

  if (u.booking_hours) {
    const hours = normalizeHours(u.booking_hours);
    if (Object.keys(hours).length) next.booking_hours = hours;
    else rejected.push("booking_hours: no valid day/time ranges (use HH:MM, start before end)");
  }

  const numeric: [keyof SetupDraft, unknown, number | null][] = [
    ["capacity_per_day", u.capacity_per_day, intInRange(u.capacity_per_day, 1, 200)],
    ["appointment_minutes", u.appointment_minutes, intInRange(u.appointment_minutes, 15, 480)],
    ["monthly_budget", u.monthly_budget, moneyInRange(u.monthly_budget, 0, 1_000_000)],
    ["target_cost_per_appointment", u.target_cost_per_appointment, moneyInRange(u.target_cost_per_appointment, 1, 100_000)],
  ];
  for (const [key, raw, value] of numeric) {
    if (raw === null || raw === undefined) continue;
    if (value === null) rejected.push(`${key}: out of range (${String(raw)})`);
    else (next[key] as number) = value;
  }

  if (u.transfer_phone) {
    const phone = normalizeUsPhone(u.transfer_phone);
    if (phone) next.transfer_phone = phone;
    else rejected.push(`transfer_phone: not a valid US phone number (${u.transfer_phone})`);
  }

  if (u.extra_questions) {
    next.extra_questions = [...new Set(u.extra_questions.map((q) => cleanText(q, 200)).filter((q) => q.length >= 5))].slice(0, 10);
  }
  // Adding their own questions means the owner has reviewed the question list.
  if (u.questions_confirmed === true || next.extra_questions.length > draft.extra_questions.length) {
    next.questions_confirmed = true;
  }
  if (u.notes) next.notes = cleanText(u.notes, 1000);

  return { draft: next, rejected };
}

// ---------------------------------------------------------------------------
// Conversion to/from stored rows
// ---------------------------------------------------------------------------

export type DemandProfileRow = {
  services: string[];
  lead_types: string[];
  customer_types: string[];
  zip_codes: string[];
  booking_hours: BookingHours;
  capacity_per_day: number | null;
  appointment_minutes: number;
  monthly_budget: number | null;
  target_cost_per_appointment: number | null;
  notes: string | null;
};

export type AgentQuestion = {
  key: string;
  question: string;
  answer_type: string;
  choices?: string[] | null;
  required: boolean;
};

export function profileFromDraft(d: SetupDraft): DemandProfileRow {
  return {
    services: d.services,
    lead_types: d.lead_types,
    customer_types: d.customer_types,
    zip_codes: d.zip_codes,
    booking_hours: d.booking_hours,
    capacity_per_day: d.capacity_per_day,
    appointment_minutes: d.appointment_minutes ?? 60,
    monthly_budget: d.monthly_budget,
    target_cost_per_appointment: d.target_cost_per_appointment,
    notes: d.notes,
  };
}

const CUSTOM_PREFIX = "custom_";

/** Default questions stay; the owner's own questions are appended (replacing earlier custom ones). */
export function questionsFromDraft(current: AgentQuestion[], d: SetupDraft): AgentQuestion[] {
  const base = current.filter((q) => !q.key.startsWith(CUSTOM_PREFIX));
  const custom = d.extra_questions.map((question, i) => ({
    key: `${CUSTOM_PREFIX}${i + 1}`,
    question,
    answer_type: "text",
    required: false,
  }));
  return [...base, ...custom];
}

/** Start a new chat from what is already saved (used when the owner updates setup later). */
export function draftFromSaved(
  p: Partial<DemandProfileRow> | null,
  agent: { questions: AgentQuestion[]; transfer_phone: string | null } | null,
): SetupDraft {
  const d = emptyDraft();
  if (p) {
    d.services = p.services ?? [];
    d.lead_types = (p.lead_types ?? []).filter((t): t is LeadType => (LEAD_TYPES as readonly string[]).includes(t));
    d.customer_types = p.customer_types ?? [];
    d.zip_codes = p.zip_codes ?? [];
    d.booking_hours = p.booking_hours ?? {};
    d.capacity_per_day = p.capacity_per_day ?? null;
    d.appointment_minutes = p.appointment_minutes ?? null;
    d.monthly_budget = p.monthly_budget === null || p.monthly_budget === undefined ? null : Number(p.monthly_budget);
    d.target_cost_per_appointment =
      p.target_cost_per_appointment === null || p.target_cost_per_appointment === undefined
        ? null
        : Number(p.target_cost_per_appointment);
    d.notes = p.notes ?? null;
  }
  if (agent) {
    d.transfer_phone = agent.transfer_phone;
    d.extra_questions = agent.questions.filter((q) => q.key.startsWith(CUSTOM_PREFIX)).map((q) => q.question);
    d.questions_confirmed = true;
  }
  return d;
}

/** "Mon–Fri 08:00–17:00, Sat 09:00–13:00" */
export function describeHours(h: BookingHours): string {
  const parts: { days: Weekday[]; ranges: string }[] = [];
  for (const day of WEEKDAYS) {
    const ranges = h[day];
    if (!ranges?.length) continue;
    const text = ranges.map((r) => `${r.start}–${r.end}`).join(", ");
    const last = parts.at(-1);
    const prevDay = last ? WEEKDAYS[WEEKDAYS.indexOf(last.days.at(-1)!) + 1] : null;
    if (last && last.ranges === text && prevDay === day) last.days.push(day);
    else parts.push({ days: [day], ranges: text });
  }
  return parts
    .map((p) => {
      const days = p.days.length > 2 ? `${WEEKDAY_LABELS[p.days[0]]}–${WEEKDAY_LABELS[p.days.at(-1)!]}` : p.days.map((d) => WEEKDAY_LABELS[d]).join(", ");
      return `${days} ${p.ranges}`;
    })
    .join("; ");
}
