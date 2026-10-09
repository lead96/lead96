/**
 * CSV lead import: parsing, column guessing and row mapping. Pure - runs in the browser for
 * the preview and is unit-tested. The server re-validates every row (see importLeads).
 */
import type { Option } from "@/lib/setup/prompts";
import { normalizeUsPhone } from "@/lib/setup/draft";
import { normalizeEmail } from "./normalize";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
/** Rows sent to the server per request (keeps each request well under the 1 MB action limit). */
export const IMPORT_CHUNK = 200;
const MAX_EXTRA_COLUMNS = 30;

/** Parses RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF, a UTF-8 BOM; comma, semicolon or tab. */
export function parseCsv(input: string): string[][] {
  // Drop the byte-order mark Excel adds to UTF-8 files.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length) endRow();
  // Drop blank lines (a lone empty field) and trim cells.
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

export const IMPORT_TARGETS = [
  { value: "full_name", label: "Full name" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "zip", label: "ZIP code" },
  { value: "service", label: "Service" },
  { value: "message", label: "Notes / message" },
  { value: "received_at", label: "Date received" },
  { value: "campaign_name", label: "Campaign" },
  { value: "utm_source", label: "UTM source" },
  { value: "utm_medium", label: "UTM medium" },
  { value: "utm_campaign", label: "UTM campaign" },
  { value: "keyword", label: "Keyword" },
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number]["value"];
/** "extra" keeps the column as a form answer on the lead; "skip" drops it. */
export type ColumnMapping = ImportTarget | "extra" | "skip";

const GUESSES: [ImportTarget, RegExp][] = [
  ["first_name", /^(first|given)[ _-]?name$|^first$/],
  ["last_name", /^(last|family|sur)[ _-]?name$|^last$|^surname$/],
  ["full_name", /^(full[ _-]?)?name$|^(customer|client|contact|lead)[ _-]?name$|^customer$|^contact$/],
  ["phone", /phone|mobile|cell|^tel|telephone|number$/],
  ["email", /e-?mail/],
  // Before service/message so "Service date" is read as a date.
  ["received_at", /^(date|created|received|submitted|timestamp)|[ _-](date|at|time)$/],
  ["zip", /zip|postal|post[ _-]?code/],
  ["service", /service|job[ _-]?type|interest|request/],
  ["message", /note|message|comment|description|details/],
  ["utm_source", /utm[ _-]?source/],
  ["utm_medium", /utm[ _-]?medium/],
  ["utm_campaign", /utm[ _-]?campaign/],
  ["campaign_name", /campaign/],
  ["keyword", /keyword|search[ _-]?term|utm[ _-]?term/],
];

/** Best guess per header; each target is used once, the rest are kept as extra info. */
export function guessMapping(headers: string[]): ColumnMapping[] {
  const used = new Set<ImportTarget>();
  return headers.map((h) => {
    const key = h.toLowerCase().replace(/[^a-z0-9 _-]/g, "").trim();
    const hit = GUESSES.find(([target, re]) => !used.has(target) && re.test(key));
    if (!hit) return "extra";
    used.add(hit[0]);
    return hit[0];
  });
}

export type ImportRow = {
  row: number; // 1-based line in the file (header = 1), for error messages
  full_name?: string;
  phone?: string;
  email?: string;
  zip?: string;
  service?: string;
  message?: string;
  received_at?: string;
  campaign_name?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  keyword?: string;
  fields?: Record<string, string>;
};

/** Applies the column mapping to the data rows (header excluded). */
export function mapRows(headers: string[], rows: string[][], mapping: ColumnMapping[], timezone: string): ImportRow[] {
  return rows.map((cells, i) => {
    const out: ImportRow = { row: i + 2 };
    const first: string[] = [];
    const last: string[] = [];
    const fields: Record<string, string> = {};
    mapping.forEach((m, col) => {
      const v = (cells[col] ?? "").trim();
      if (!v || m === "skip") return;
      if (m === "extra") {
        if (Object.keys(fields).length < MAX_EXTRA_COLUMNS) fields[fieldKey(headers[col], col)] = v.slice(0, 500);
      } else if (m === "first_name") first.push(v);
      else if (m === "last_name") last.push(v);
      else if (m === "received_at") out.received_at = parseLeadDate(v, timezone) ?? undefined;
      else out[m] = out[m] ? `${out[m]} ${v}` : v;
    });
    if (!out.full_name && (first.length || last.length)) out.full_name = [...first, ...last].join(" ");
    if (Object.keys(fields).length) out.fields = fields;
    return out;
  });
}

const fieldKey = (header: string, col: number) =>
  header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `column_${col + 1}`;

/** Why a mapped row can't be imported, or null if it can. */
export function rowProblem(r: ImportRow): string | null {
  const phone = r.phone ? normalizeUsPhone(r.phone) : null;
  const email = normalizeEmail(r.email);
  if (phone || email) return null;
  if (r.phone || r.email) return "Phone and email are not valid";
  return "No phone or email";
}

/** Taxonomy value for a service written as its label or value ("AC repair" -> "ac_repair"), else the text. */
export function matchService(text: string | undefined, services: Option[]): string | undefined {
  if (!text) return undefined;
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hit = services.find((s) => [s.label, s.value].some((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key));
  return hit?.value ?? text;
}

/**
 * Dates as US spreadsheets write them: ISO 8601, YYYY-MM-DD, M/D/YYYY (2-digit years ok),
 * optionally with H:MM[:SS] [AM/PM]. Times without a zone are read in the workspace timezone.
 * Returns ISO UTC, or null for anything unreadable, before 2000 or in the future.
 */
export function parseLeadDate(input: string, timezone: string, now = new Date()): string | null {
  const s = input.trim();
  let date: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    date = new Date(s);
  } else {
    const m =
      s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i)?.slice(1).map((v) => v ?? "") ??
      reorderUs(s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i));
    if (m) {
      const [y, mo, d, h = "", mi = "", sec = "", ampm = ""] = m;
      let hour = h ? Number(h) : 12; // date only -> midday, so the day never shifts across zones
      if (ampm) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
      }
      const parts = [Number(y), Number(mo), Number(d), hour, Number(mi || 0), Number(sec || 0)] as const;
      if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31 || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return null;
      date = zonedTime(...parts, timezone);
      // Reject impossible days like 2/30, which Date would roll into March.
      if (date && localDay(date, timezone) !== parts[2]) return null;
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() < 2000 || date.getTime() > now.getTime() + 60 * 60 * 1000) return null;
  return date.toISOString();
}

function reorderUs(m: RegExpMatchArray | null): string[] | null {
  if (!m) return null;
  const [, mo, d, y, ...rest] = m.map((v) => v ?? "");
  const year = y.length === 2 ? String(2000 + Number(y)) : y;
  return [year, mo, d, ...rest];
}

/** The UTC instant at which the wall clock in `timezone` shows the given time. */
function zonedTime(y: number, mo: number, d: number, h: number, mi: number, s: number, timezone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, Number(x.value)]),
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  // Two passes settle DST transitions.
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

const localDay = (date: Date, timezone: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).format(date));
