/**
 * Service-area helpers for the setup chat. Pure functions — unit-tested.
 * ZIP data comes from public.us_zip_codes (GeoNames); the AI never invents ZIP codes.
 */
import { parseZips } from "./draft";

export const DEFAULT_RADIUS_MILES = 15;
export const MIN_RADIUS_MILES = 1;
export const MAX_RADIUS_MILES = 60;
/** More than this and the area is too broad to be useful for local ads. */
export const MAX_AREA_ZIPS = 300;

/** What the model may ask the app to look up when the owner names a place instead of ZIPs. */
export type AreaLookup = {
  city: string | null;
  state: string | null;
  center_zip: string | null;
  radius_miles: number | null;
};

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

/**
 * Clean up what the model extracted: "Miami, FL" / "Miami FL" in the city field → city + state,
 * filler words ("around", "near", "city of") removed, state upper-cased and validated.
 */
export function normalizeAreaLookup(l: AreaLookup): AreaLookup {
  let city = (l.city ?? "")
    .replace(/\b(around|near|in|the|city of|area|metro|greater)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  let state = l.state?.trim().toUpperCase() || null;
  const m = city.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (m && US_STATES.has(m[2].toUpperCase())) {
    city = m[1].trim();
    state ??= m[2].toUpperCase();
  }
  city = city.replace(/[,.]+$/, "").trim();
  return { ...l, city: city || null, state: state && US_STATES.has(state) ? state : null };
}

/**
 * True if the owner's latest message actually names the place (or centre ZIP) the model
 * wants to look up. Stops the model from re-running an earlier lookup it saw in the history.
 */
export function messageMentionsPlace(text: string, l: AreaLookup): boolean {
  const t = text.toLowerCase();
  const zip = l.center_zip?.match(/\d{5}/)?.[0];
  if (zip && t.includes(zip)) return true;
  return Boolean(l.city && t.includes(l.city.toLowerCase()));
}

/** A city name is "clearly" one place when its top match has this many times more ZIPs than the next. */
export const DOMINANT_CITY_RATIO = 5;

/**
 * Pick the obvious city for a name ("Miami" → Miami, FL), or null when several are
 * plausible ("Springfield", "Columbus", "Kansas City") and the owner should choose.
 */
export function pickDominantCity<T extends { zip_count: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const [top, second] = [...rows].sort((a, b) => Number(b.zip_count) - Number(a.zip_count));
  return Number(top.zip_count) >= DOMINANT_CITY_RATIO * Number(second.zip_count) ? top : null;
}

export function clampRadius(miles: number | null | undefined) {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return DEFAULT_RADIUS_MILES;
  return Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, Math.round(miles)));
}

/**
 * If a message is essentially a pasted ZIP list (3+ ZIPs and little else), return the ZIPs.
 * These messages skip the model: no tokens spent, nothing to misread.
 */
export function extractZipList(text: string): string[] | null {
  const zips = parseZips(text);
  if (zips.length < 3) return null;
  const leftover = text
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    .replace(/\b(zip|zips|zip codes?|codes?|service area|we serve|here|are|my|our|list|the|and|is|:)\b/gi, "")
    .replace(/[\s,;|/\-–—.()\[\]"']+/g, "");
  return leftover.length <= 20 ? zips : null;
}

/** "Found 95 ZIP codes within 15 miles of Miami, FL — e.g. 33101, 33125, 33130 and 92 more." */
export function describeAreaResult(zips: string[], label: string, miles: number) {
  const sample = zips.slice(0, 3).join(", ");
  const rest = zips.length - 3;
  return `Found ${zips.length} ZIP code${zips.length === 1 ? "" : "s"} within ${miles} miles of ${label} — ${
    rest > 0 ? `e.g. ${sample} and ${rest} more` : sample
  }. I've added them; you can remove any later in Business profile.`;
}

export function cityLabel(city: string, state: string) {
  return `${city}, ${state}`;
}

/** Parse a "City, ST" button label back into its parts (used when the owner picks a state). */
export function parseCityLabel(label: string): { city: string; state: string } | null {
  const m = label.trim().match(/^(.+?),\s*([A-Za-z]{2})$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
}
