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
