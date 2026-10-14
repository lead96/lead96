/**
 * Visit windows the AI may offer, from the business's visit hours (no calendar yet: M4 replaces
 * this with real free/busy and capacity). Pure - unit-tested.
 *
 * Each day's hours are split at noon into a morning and an afternoon window, the way contractors
 * usually book ("Tuesday 8 to 12"). Today's windows need at least LEAD_TIME_MIN of notice.
 */
import { WEEKDAYS, WEEKDAY_LABELS, type BookingHours, type Weekday } from "@/lib/setup/draft";

export const LEAD_TIME_MIN = 120;
const NOON = 12 * 60;

export type VisitWindow = { date: string; day: string; start: string; end: string; label: string };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const spoken = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

/** Local calendar date, weekday and minutes since midnight of an instant in a time zone. */
function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday").toLowerCase().slice(0, 3) as Weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function availableWindows(hours: BookingHours, timezone: string, now: Date, days = 5): VisitWindow[] {
  const out: VisitWindow[] = [];
  const today = localParts(now, timezone);
  // Step through calendar days by noon UTC of each local date (DST-safe enough for whole days).
  const [y, mo, d] = today.date.split("-").map(Number);
  for (let i = 0; i < 14; i++) {
    const noonUtc = new Date(Date.UTC(y, mo - 1, d + i, 12));
    const local = localParts(noonUtc, "UTC");
    const weekday = WEEKDAYS[(noonUtc.getUTCDay() + 6) % 7];
    const ranges = hours[weekday] ?? [];
    const dayLabel = `${WEEKDAY_LABELS[weekday]} ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(noonUtc)}`;
    const dayWindows: VisitWindow[] = [];
    for (const r of ranges) {
      const start = toMin(r.start);
      const end = toMin(r.end);
      if (!(end > start)) continue;
      const pieces = start < NOON && end > NOON ? [[start, NOON], [NOON, end]] : [[start, end]];
      for (const [s, e] of pieces) {
        if (i === 0 && s < today.minutes + LEAD_TIME_MIN) continue;
        if (e - s < 60) continue;
        dayWindows.push({ date: local.date, day: dayLabel, start: toHHMM(s), end: toHHMM(e), label: `${dayLabel}, ${spoken(s)} to ${spoken(e)}` });
      }
    }
    if (dayWindows.length) out.push(...dayWindows);
    if (new Set(out.map((w) => w.date)).size >= days) break;
  }
  return out;
}
