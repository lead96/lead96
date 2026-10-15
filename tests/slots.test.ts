import { describe, expect, it } from "vitest";
import { capacityFor, friendlyHours, localToUtc, openWindows } from "@/lib/calendar/slots";

const weekdays = { start: "08:00", end: "17:00" };
const hours = { mon: [weekdays], tue: [weekdays], wed: [weekdays], thu: [weekdays], fri: [weekdays] };
// Wed 2026-10-14 15:00 UTC = 10:00 Chicago (CDT, UTC-5).
const now = new Date("2026-10-14T15:00:00Z");
const tz = "America/Chicago";

describe("local time -> instant", () => {
  it("handles the business time zone and DST", () => {
    expect(localToUtc("2026-10-15", "08:00", tz).toISOString()).toBe("2026-10-15T13:00:00.000Z"); // CDT
    expect(localToUtc("2026-11-03", "08:00", tz).toISOString()).toBe("2026-11-03T14:00:00.000Z"); // CST after Nov 1
    expect(localToUtc("2026-10-15", "12:00", "America/New_York").toISOString()).toBe("2026-10-15T16:00:00.000Z");
  });
});

describe("capacity", () => {
  it("spreads jobs per day over the windows; one per window when not set", () => {
    expect(capacityFor(8, 2)).toEqual({ windowCap: 4, dayCap: 8 });
    expect(capacityFor(3, 2)).toEqual({ windowCap: 2, dayCap: 3 });
    expect(capacityFor(null, 2)).toEqual({ windowCap: 1, dayCap: 2 });
  });
});

describe("open windows", () => {
  const base = { hours, timezone: tz, now, days: 2, capacityPerDay: 2, booked: [], blackouts: [] };

  it("offers windows with exact start and end instants", () => {
    const w = openWindows(base);
    expect(w.map((x) => x.label)).toEqual(["Wed Oct 14, 12pm to 5pm", "Thu Oct 15, 8am to 12pm", "Thu Oct 15, 12pm to 5pm"]);
    expect(w[1]).toMatchObject({ startsAt: "2026-10-15T13:00:00.000Z", endsAt: "2026-10-15T17:00:00.000Z", left: 1, windowCap: 1, dayCap: 2 });
  });

  it("drops a full window, then a full day, and ignores cancelled visits", () => {
    const thuMorning = { starts_at: "2026-10-15T13:00:00.000Z", ends_at: "2026-10-15T17:00:00.000Z", status: "scheduled" };
    const thuAfternoon = { starts_at: "2026-10-15T17:00:00.000Z", ends_at: "2026-10-15T22:00:00.000Z", status: "confirmed" };
    expect(openWindows({ ...base, booked: [thuMorning] }).map((x) => x.label)).toEqual(["Wed Oct 14, 12pm to 5pm", "Thu Oct 15, 12pm to 5pm"]);
    // Thursday full: the next open day fills the 2 days asked for.
    expect(openWindows({ ...base, booked: [thuMorning, thuAfternoon] }).map((x) => x.date)).toEqual(["2026-10-14", "2026-10-16", "2026-10-16"]);
    expect(openWindows({ ...base, booked: [{ ...thuMorning, status: "cancelled" }] }).map((x) => x.label)).toContain("Thu Oct 15, 8am to 12pm");
  });

  it("a booking right after a window does not fill it (database time format)", () => {
    // Thursday afternoon booked, written by the database as "+00:00": Thursday morning stays open.
    const thuAfternoon = { starts_at: "2026-10-15T17:00:00+00:00", ends_at: "2026-10-15T22:00:00+00:00", status: "scheduled" };
    expect(openWindows({ ...base, booked: [thuAfternoon] }).map((x) => x.label)).toContain("Thu Oct 15, 8am to 12pm");
  });

  it("skips blocked days", () => {
    const w = openWindows({ ...base, blackouts: [{ starts_on: "2026-10-15", ends_on: "2026-10-16" }] });
    expect(w.map((x) => x.date)).toEqual(["2026-10-14", "2026-10-19", "2026-10-19"]);
  });
});


describe("visit hours summary", () => {
  it("groups days with the same hours", () => {
    expect(friendlyHours(hours)).toBe("Mon-Fri 8am-5pm");
    expect(friendlyHours({ ...hours, sat: [{ start: "09:00", end: "13:30" }] })).toBe("Mon-Fri 8am-5pm; Sat 9am-1:30pm");
    expect(friendlyHours({ ...hours, sat: [weekdays], sun: [weekdays] })).toBe("Every day 8am-5pm");
    expect(friendlyHours({ mon: [weekdays], wed: [weekdays] })).toBe("Mon 8am-5pm; Wed 8am-5pm");
    expect(friendlyHours({})).toBe("Not set");
  });
});
