import { describe, expect, it } from "vitest";
import { buildAttribution, buildLines, periodFor, rate } from "@/lib/dashboard/report";

const TZ = "America/Chicago";
const at = new Date("2026-10-15T03:30:00Z"); // still Oct 14 in Chicago

describe("dashboard periods", () => {
  it("counts days in the business time zone", () => {
    const p = periodFor("7d", TZ, at);
    expect(p).toMatchObject({ key: "7d", fromDate: "2026-10-08", toDate: "2026-10-14" });
    expect(p.from.toISOString()).toBe("2026-10-08T05:00:00.000Z"); // local midnight (CDT)
    expect(p.to.toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });
  it("handles this month, last month, defaults and the DST change", () => {
    expect(periodFor("month", TZ, at)).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-10-14" });
    expect(periodFor("last_month", TZ, at)).toMatchObject({ fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect(periodFor("nonsense", TZ, at).key).toBe("30d");
    // November 1 is the end of daylight time: the next midnight is an hour later in UTC.
    const nov = periodFor("last_month", TZ, new Date("2026-12-10T12:00:00Z"));
    expect(nov.from.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(nov.to.toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });
});

describe("dashboard lines", () => {
  const row = (channel: string, leads: number, booked: number, extra = {}) => ({ channel, leads, qualified: booked, booked, showed: 0, won: 0, lost: 0, not_qualified: 0, revenue: 0, ...extra });

  it("puts ad spend on its channel and works out cost per lead and per booking", () => {
    const { lines, total } = buildLines({
      channels: [row("google_ads", 10, 4, { won: 1, revenue: "4500.00" }), row("landing_page", 5, 1)],
      spend: [{ platform: "google", cost: 600, clicks: 90, currency: "USD" }],
    });
    const g = lines.find((l) => l.channel === "google_ads")!;
    expect(g).toMatchObject({ label: "Google Ads", spend: 600, costPerLead: 60, costPerBooking: 150, revenue: 4500 });
    expect(lines.find((l) => l.channel === "landing_page")).toMatchObject({ spend: null, costPerLead: null });
    expect(total).toMatchObject({ leads: 15, booked: 5, spend: 600, costPerBooking: 120, revenue: 4500 });
  });
  it("shows money spent with no leads, and no cost when nothing was booked", () => {
    const { lines, total } = buildLines({ channels: [], spend: [{ platform: "meta", cost: 250, clicks: 40, currency: "USD" }] });
    expect(lines).toEqual([expect.objectContaining({ channel: "meta_ads", leads: 0, spend: 250, costPerLead: null, costPerBooking: null })]);
    expect(total.costPerBooking).toBeNull();
    expect(buildLines({ channels: [row("call", 3, 1)], spend: [] }).total.spend).toBeNull();
  });
  it("rates", () => {
    expect(rate(3, 12)).toBe("25%");
    expect(rate(0, 0)).toBe("-");
  });
});

describe("attribution", () => {
  const r = (channel: string, key: string | null, label: string | null, leads: number, booked: number) => ({ channel, key, label, leads, qualified: booked, booked, showed: 0, won: 0, lost: 0, not_qualified: 0, revenue: 0 });

  it("matches campaign spend by ID, or by name for utm_campaign leads, and keeps unmatched spend", () => {
    const lines = buildAttribution("campaign", {
      rows: [r("google_ads", "111", "AC Repair Dallas", 4, 2), r("google_ads", "fall tune-up", "fall tune-up", 2, 0), r("landing_page", null, null, 3, 1)],
      spend: [
        { platform: "google", campaign_id: "111", campaign_name: "AC Repair Dallas", cost: 400, clicks: 80 },
        { platform: "google", campaign_id: "222", campaign_name: "Fall Tune-Up", cost: 100, clicks: 20 },
        { platform: "meta", campaign_id: "m9", campaign_name: "Spring promo", cost: 50, clicks: 5 },
      ],
    });
    expect(lines.find((l) => l.key === "google_ads|111")).toMatchObject({ spend: 400, costPerLead: 100, costPerBooking: 200, sub: "Google Ads" });
    expect(lines.find((l) => l.key === "google_ads|fall tune-up")).toMatchObject({ spend: 100, costPerLead: 50, costPerBooking: null });
    expect(lines.find((l) => l.key === "landing_page|")).toMatchObject({ label: "No campaign", spend: null });
    expect(lines.find((l) => l.key === "meta_ads|m9")).toMatchObject({ label: "Spring promo", leads: 0, spend: 50, sub: "Facebook / Instagram ads · spend with no leads yet" });
  });

  it("never puts spend on other breakdowns", () => {
    const lines = buildAttribution("keyword", { rows: [r("google_ads", "ac repair near me", "ac repair near me", 3, 1)], spend: [] });
    expect(lines[0]).toMatchObject({ label: "ac repair near me", spend: null, costPerLead: null });
    expect(buildAttribution("ad", { rows: [r("call", null, null, 1, 0)], spend: [] })[0].label).toBe("No ad");
  });
});
