import { localToUtc } from "@/lib/calendar/slots";

/**
 * Dashboard maths (pure, unit-tested): reporting periods in the business time zone, channel
 * totals and cost per result. The counts come from dashboard_report() (migration 024).
 */

export const RANGES = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  last_month: "Last month",
} as const;
export type RangeKey = keyof typeof RANGES;

export type Period = { key: RangeKey; label: string; fromDate: string; toDate: string; from: Date; to: Date };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));

/** The period's first and last day (inclusive) in the business time zone, and its UTC bounds. */
export function periodFor(key: string | undefined, timezone: string, now = new Date()): Period {
  const k: RangeKey = key && key in RANGES ? (key as RangeKey) : "30d";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  let fromDate: string;
  let toDate = today;
  if (k === "month") fromDate = `${today.slice(0, 8)}01`;
  else if (k === "last_month") {
    toDate = addDays(`${today.slice(0, 8)}01`, -1);
    fromDate = `${toDate.slice(0, 8)}01`;
  } else fromDate = addDays(today, -(Number(k.replace("d", "")) - 1));
  return {
    key: k,
    label: RANGES[k],
    fromDate,
    toDate,
    from: localToUtc(fromDate, "00:00", timezone),
    to: localToUtc(addDays(toDate, 1), "00:00", timezone),
  };
}

export const CHANNEL_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Facebook / Instagram ads",
  landing_page: "Landing page (no ad click)",
  call: "Phone call",
  website: "Website",
  csv: "CSV import",
  manual: "Added by hand",
  google: "Google",
  meta: "Facebook",
};
/** Channels that ad spend belongs to. */
export const SPEND_PLATFORM: Record<string, "google" | "meta"> = { google_ads: "google", meta_ads: "meta" };

export type ChannelRow = { channel: string; leads: number; qualified: number; booked: number; showed: number; won: number; lost: number; not_qualified: number; revenue: number };
export type SpendRow = { platform: "google" | "meta"; cost: number; clicks: number; currency: string | null };
export type Report = { channels: ChannelRow[]; spend: SpendRow[] };

export type Line = ChannelRow & { label: string; spend: number | null; costPerLead: number | null; costPerBooking: number | null };

const STAGES = ["leads", "qualified", "booked", "showed", "won", "lost", "not_qualified", "revenue"] as const;

/** Rows per channel with their spend, plus the total row. Spend without leads still shows (money with no result). */
export function buildLines(r: Report): { lines: Line[]; total: Line } {
  const spendOf = new Map(r.spend.map((s) => [s.platform, Number(s.cost) || 0]));
  const rows = r.channels.map((c) => ({ ...c, revenue: Number(c.revenue) || 0 }));
  for (const [channel, platform] of Object.entries(SPEND_PLATFORM)) {
    if (spendOf.get(platform) && !rows.some((c) => c.channel === channel)) {
      rows.push({ channel, leads: 0, qualified: 0, booked: 0, showed: 0, won: 0, lost: 0, not_qualified: 0, revenue: 0 });
    }
  }
  const line = (c: ChannelRow, spend: number | null): Line => ({
    ...c,
    label: CHANNEL_LABELS[c.channel] ?? c.channel,
    spend,
    costPerLead: spend !== null && c.leads ? spend / c.leads : null,
    costPerBooking: spend !== null && c.booked ? spend / c.booked : null,
  });
  const lines = rows.map((c) => line(c, SPEND_PLATFORM[c.channel] ? (spendOf.get(SPEND_PLATFORM[c.channel]) ?? 0) : null));
  const sum = Object.fromEntries(STAGES.map((k) => [k, rows.reduce((n, c) => n + Number(c[k]), 0)])) as Omit<ChannelRow, "channel">;
  const totalSpend = r.spend.length ? [...spendOf.values()].reduce((a, b) => a + b, 0) : null;
  return { lines, total: line({ channel: "total", ...sum }, totalSpend) };
}

/** 12 of 40 -> "30%"; nothing to divide -> "-". */
export function rate(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "-";
}

export const DIMENSIONS = {
  source: "Source",
  campaign: "Campaign",
  landing_page: "Landing page",
  ad: "Ad",
  keyword: "Keyword",
} as const;
export type Dimension = keyof typeof DIMENSIONS;

const UNKNOWN: Record<Exclude<Dimension, "source">, string> = {
  campaign: "No campaign",
  landing_page: "Not from a landing page",
  ad: "No ad",
  keyword: "No keyword",
};

export type AttributionRow = ChannelRow & { key: string | null; label: string | null };
export type CampaignSpend = { platform: "google" | "meta"; campaign_id: string; campaign_name: string | null; cost: number; clicks: number };
export type AttributionLine = Line & { key: string; sub: string };

/**
 * Rows of one dimension (campaign, landing page, ad, keyword) with the channel underneath. Campaign
 * spend is matched to its campaign by ID, or by name for landing page leads that only carry
 * utm_campaign; spend no lead matched is shown as its own row so no money goes missing.
 */
export function buildAttribution(dim: Exclude<Dimension, "source">, data: { rows: AttributionRow[]; spend: CampaignSpend[] }) {
  const lines: AttributionLine[] = data.rows.map((r) => ({
    ...r,
    revenue: Number(r.revenue) || 0,
    key: `${r.channel}|${r.key ?? ""}`,
    label: r.key === null ? UNKNOWN[dim] : (r.label ?? r.key),
    sub: CHANNEL_LABELS[r.channel] ?? r.channel,
    spend: null,
    costPerLead: null,
    costPerBooking: null,
  }));
  if (dim === "campaign") {
    for (const s of data.spend) {
      const channel = s.platform === "google" ? "google_ads" : "meta_ads";
      const name = (s.campaign_name ?? "").trim().toLowerCase();
      const hit =
        lines.find((l) => l.channel === channel && l.key === `${channel}|${s.campaign_id}`) ??
        lines.find((l) => l.channel === channel && name !== "" && l.key.slice(channel.length + 1).trim().toLowerCase() === name);
      const cost = Number(s.cost) || 0;
      if (hit) hit.spend = (hit.spend ?? 0) + cost;
      else
        lines.push({
          channel,
          key: `${channel}|${s.campaign_id}`,
          label: s.campaign_name || s.campaign_id,
          sub: `${CHANNEL_LABELS[channel]} · spend with no leads yet`,
          leads: 0,
          qualified: 0,
          booked: 0,
          showed: 0,
          won: 0,
          lost: 0,
          not_qualified: 0,
          revenue: 0,
          spend: cost,
          costPerLead: null,
          costPerBooking: null,
        });
    }
    for (const l of lines) {
      if (l.spend === null) continue;
      l.costPerLead = l.leads ? l.spend / l.leads : null;
      l.costPerBooking = l.booked ? l.spend / l.booked : null;
    }
  }
  return lines;
}
