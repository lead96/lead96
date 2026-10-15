/**
 * Availability engine: which visit windows can still be booked. Pure - unit-tested.
 *
 * Windows come from the visit hours (split at noon, see voice/availability.ts). Capacity comes from
 * the setup's "jobs per day", spread over that day's windows; without it, one visit per window.
 * Blackout days are closed. The database re-checks the same numbers under a lock when booking.
 */
import type { BookingHours } from "@/lib/setup/draft";
import { availableWindows } from "@/lib/voice/availability";

export type Booked = { starts_at: string; ends_at: string; status: string };
export type Blackout = { starts_on: string; ends_on: string };
export type OpenWindow = {
  date: string;
  start: string;
  end: string;
  label: string;
  startsAt: string;
  endsAt: string;
  left: number;
  windowCap: number;
  dayCap: number;
};

/** The instant of a local date + time in a time zone (DST-safe). */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (at: number) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - at;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // second pass corrects across a DST change
  return new Date(t);
}

/** How many visits a window and a day may take. */
export function capacityFor(capacityPerDay: number | null | undefined, windowsThatDay: number) {
  const n = Math.max(1, windowsThatDay);
  if (!capacityPerDay || capacityPerDay < 1) return { windowCap: 1, dayCap: n };
  return { windowCap: Math.max(1, Math.ceil(capacityPerDay / n)), dayCap: capacityPerDay };
}

const localDate = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function openWindows(p: {
  hours: BookingHours;
  timezone: string;
  now: Date;
  days?: number;
  capacityPerDay: number | null;
  booked: Booked[];
  blackouts: Blackout[];
}): OpenWindow[] {
  const days = p.days ?? 5;
  const active = p.booked.filter((b) => b.status !== "cancelled");
  // Look further ahead than needed: full and blocked days drop out.
  const candidates = availableWindows(p.hours, p.timezone, p.now, days + 10);
  const perDay = new Map<string, number>();
  for (const w of candidates) perDay.set(w.date, (perDay.get(w.date) ?? 0) + 1);

  const out: OpenWindow[] = [];
  for (const w of candidates) {
    if (p.blackouts.some((b) => w.date >= b.starts_on && w.date <= b.ends_on)) continue;
    const { windowCap, dayCap } = capacityFor(p.capacityPerDay, perDay.get(w.date) ?? 1);
    const startsAt = localToUtc(w.date, w.start, p.timezone).toISOString();
    const endsAt = localToUtc(w.date, w.end, p.timezone).toISOString();
    // Compare instants, not strings: the database writes "+00:00", we write "Z".
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    const inWindow = active.filter((b) => Date.parse(b.starts_at) < e && Date.parse(b.ends_at) > s).length;
    const inDay = active.filter((b) => localDate(b.starts_at, p.timezone) === w.date).length;
    const left = Math.min(windowCap - inWindow, dayCap - inDay);
    if (left <= 0) continue;
    out.push({ date: w.date, start: w.start, end: w.end, label: w.label, startsAt, endsAt, left, windowCap, dayCap });
  }
  const keep = new Set([...new Set(out.map((w) => w.date))].slice(0, days));
  return out.filter((w) => keep.has(w.date));
}

const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** "Mon-Fri 8am-5pm; Sat 9am-1pm", or "Every day 8am-5pm". Closed days are left out. */
export function friendlyHours(hours: BookingHours): string {
  const text = DAYS.map((d) => (hours[d] ?? []).map((r) => `${ampm(r.start)}-${ampm(r.end)}`).join(", "));
  if (text.every((t) => t && t === text[0])) return `Every day ${text[0]}`;
  const groups: { from: number; to: number; text: string }[] = [];
  text.forEach((t, i) => {
    if (!t) return;
    const last = groups.at(-1);
    if (last && last.to === i - 1 && last.text === t) last.to = i;
    else groups.push({ from: i, to: i, text: t });
  });
  if (!groups.length) return "Not set";
  return groups.map((g) => `${DAY_NAMES[DAYS[g.from]]}${g.to > g.from ? `-${DAY_NAMES[DAYS[g.to]]}` : ""} ${g.text}`).join("; ");
}
