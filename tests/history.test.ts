import { describe, expect, it } from "vitest";
import { fieldChanges, rowLabel, showValue } from "@/lib/history";

describe("change history display", () => {
  it("lists each changed field with old and new value", () => {
    expect(
      fieldChanges({ changed_fields: ["status", "do_not_call"], old_values: { status: "new", do_not_call: false }, new_values: { status: "contacted", do_not_call: true } }),
    ).toEqual([
      { field: "status", from: "new", to: "contacted" },
      { field: "do not call", from: "false", to: "true" },
    ]);
  });
  it("shows empty and long values readably", () => {
    expect(showValue(null)).toBe("(empty)");
    expect(showValue("")).toBe("(empty)");
    expect(showValue({ a: 1 })).toBe('{"a":1}');
    expect(showValue("x".repeat(200))).toHaveLength(80);
  });
  it("names the row from its values", () => {
    expect(rowLabel("customers", { full_name: "Maria Lopez", phone: "+12145550142" })).toBe("Maria Lopez");
    expect(rowLabel("customers", { full_name: " ", phone: "+12145550142" })).toBe("+12145550142");
    expect(rowLabel("landing_pages", { slug: "cool-air" })).toBe("cool-air");
    expect(rowLabel("demand_profiles", { services: [] })).toBeNull();
  });
});
