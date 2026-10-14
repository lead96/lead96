import { describe, expect, it } from "vitest";
import { availableWindows } from "@/lib/voice/availability";

// Wed 2026-10-14 15:00 UTC = 10:00 in Chicago.
const now = new Date("2026-10-14T15:00:00Z");
const hours = {
  mon: [{ start: "08:00", end: "17:00" }],
  tue: [{ start: "08:00", end: "17:00" }],
  wed: [{ start: "08:00", end: "17:00" }],
  thu: [{ start: "08:00", end: "17:00" }],
  fri: [{ start: "08:00", end: "17:00" }],
  sat: [{ start: "09:00", end: "13:00" }],
};

describe("visit windows offered by the AI", () => {
  it("splits each day at noon and skips today's windows without 2 hours notice", () => {
    const w = availableWindows(hours, "America/Chicago", now, 3);
    expect(w.map((x) => x.label)).toEqual([
      "Wed Oct 14, 12pm to 5pm",
      "Thu Oct 15, 8am to 12pm",
      "Thu Oct 15, 12pm to 5pm",
      "Fri Oct 16, 8am to 12pm",
      "Fri Oct 16, 12pm to 5pm",
    ]);
    expect(w[0]).toMatchObject({ date: "2026-10-14", start: "12:00", end: "17:00" });
  });

  it("skips closed days and keeps short Saturday hours whole", () => {
    const w = availableWindows(hours, "America/Chicago", now, 5);
    const sat = w.filter((x) => x.date === "2026-10-17");
    expect(sat.map((x) => x.label)).toEqual(["Sat Oct 17, 9am to 12pm", "Sat Oct 17, 12pm to 1pm"]);
    expect(w.some((x) => x.date === "2026-10-18")).toBe(false); // Sunday closed
    expect(new Set(w.map((x) => x.date)).size).toBe(5);
  });

  it("uses the business time zone for 'today'", () => {
    // 2026-10-15 03:30 UTC is still Oct 14 22:30 in Chicago: today is over, start tomorrow.
    const w = availableWindows(hours, "America/Chicago", new Date("2026-10-15T03:30:00Z"), 1);
    expect(w.map((x) => x.label)).toEqual(["Thu Oct 15, 8am to 12pm", "Thu Oct 15, 12pm to 5pm"]);
  });

  it("returns nothing when no visit hours are set", () => {
    expect(availableWindows({}, "America/Chicago", now)).toEqual([]);
  });
});
