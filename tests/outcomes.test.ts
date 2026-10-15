import { describe, expect, it } from "vitest";
import { LOST_REASONS, money, NOT_QUALIFIED_REASONS, outcomeNeeds, parseAmount, reasonLabel } from "@/lib/leads/outcomes";

describe("outcomes", () => {
  it("asks for a reason or an amount only where the result needs one", () => {
    expect(outcomeNeeds("won")).toEqual({ amount: "revenue" });
    expect(outcomeNeeds("estimate")).toEqual({ amount: "estimate" });
    expect(outcomeNeeds("lost").reason).toBe(LOST_REASONS);
    expect(outcomeNeeds("not_qualified").reason).toBe(NOT_QUALIFIED_REASONS);
    expect(outcomeNeeds("showed")).toEqual({});
  });

  it("reads dollar amounts the way people type them", () => {
    expect(parseAmount("4500")).toBe(4500);
    expect(parseAmount("$4,500.50")).toBe(4500.5);
    expect(parseAmount(" 900 ")).toBe(900);
    for (const bad of ["", "0", "-5", "4.555", "abc", "12e3", "10000000"]) expect(parseAmount(bad)).toBeNull();
  });

  it("shows money and reasons in plain words", () => {
    expect(money(4500)).toBe("$4,500");
    expect(money("1250.5")).toBe("$1,250.50");
    expect(money(null)).toBe("-");
    expect(reasonLabel("competitor")).toBe("Chose a competitor");
    expect(reasonLabel("outside_area")).toBe("Outside the service area");
    expect(reasonLabel(null)).toBeNull();
  });
});
