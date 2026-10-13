import { describe, expect, it } from "vitest";
import { isUndeliverableAddress } from "@/lib/email/address";
import { inviteEmail } from "@/lib/email/templates";

describe("invite email", () => {
  const url = "https://lead96.com/invite/abc123";

  it("names the team, inviter and role, and links the invite", () => {
    const e = inviteEmail({
      team: "Cool Air HVAC",
      inviter: "Maria Lopez",
      role: "staff",
      url,
    });
    expect(e.subject).toBe("Join Cool Air HVAC on Lead96");
    expect(e.html).toContain(`href="${url}"`);
    expect(e.html).toContain("Maria Lopez invited you to join Cool Air HVAC as a team member");
    expect(e.text).toContain(`Accept the invite: ${url}`);
  });

  it("works without an inviter name and for owners", () => {
    const e = inviteEmail({
      team: "Cool Air",
      inviter: null,
      role: "owner",
      url,
    });
    expect(e.text).toMatch(/^You've been invited to join Cool Air as an owner/);
  });

  it("escapes HTML in names typed by users", () => {
    const e = inviteEmail({
      team: `<script>x</script> & "Co"`,
      inviter: "<b>Eve</b>",
      role: "staff",
      url,
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>Eve</b>");
    expect(e.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; &quot;Co&quot;");
  });
});

describe("test addresses are never emailed", () => {
  it("skips reserved domains used by tests and examples", () => {
    for (const a of ["b-1@test.leadgen.invalid", "x@foo.test", "x@example.com", "x@mail.example.org", "x@localhost"])
      expect(isUndeliverableAddress(a)).toBe(true);
  });
  it("allows real domains", () => {
    for (const a of ["kaen197517@gmail.com", "admin@lead96.com", "x@examples.com"]) expect(isUndeliverableAddress(a)).toBe(false);
  });
});
