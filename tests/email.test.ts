import { describe, expect, it } from "vitest";
import { isUndeliverableAddress } from "@/lib/email/address";
import { inviteEmail, opsAlertEmail, pendingOutcomesEmail, teamBookingEmail, visitEmail } from "@/lib/email/templates";

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

describe("visit emails", () => {
  const p = { business: "Cool Air HVAC", firstName: "Maria", when: "Thu Oct 15, 8am - 12pm", address: "77 Elm St, 75201", businessPhone: "+12145550100" };
  it("confirmation names the business, the window, the address and how to change it", () => {
    const e = visitEmail("confirmation", p);
    expect(e.subject).toBe("Your visit with Cool Air HVAC is booked: Thu Oct 15, 8am - 12pm");
    expect(e.text).toContain("Hi Maria,");
    expect(e.text).toContain("77 Elm St, 75201");
    expect(e.text).toContain("call us at (214) 555-0100");
  });
  it("each kind has its own subject; cancelled does not show the window as a booking", () => {
    expect(visitEmail("reminder_24h", p).subject).toMatch(/^Reminder: Cool Air HVAC visit tomorrow/);
    expect(visitEmail("reminder_2h", p).subject).toMatch(/arrives soon/);
    expect(visitEmail("rescheduled", p).subject).toMatch(/was moved/);
    const c = visitEmail("cancelled", p);
    expect(c.subject).toBe("Your Cool Air HVAC visit was cancelled");
    expect(c.text).not.toContain("77 Elm St");
  });
  it("works without a name or phone, and escapes HTML", () => {
    const e = visitEmail("confirmation", { ...p, firstName: null, businessPhone: null, business: "<b>Bad</b>" });
    expect(e.text.startsWith("Hi,")).toBe(true);
    expect(e.text).toContain("reply to this email");
    expect(e.html).not.toContain("<b>Bad</b>");
  });
  it("tells the team about new bookings with a link to the calendar", () => {
    const e = teamBookingEmail({ business: "Cool Air HVAC", customer: "Maria Lopez", phone: "+12145550142", when: "Thu Oct 15, 8am - 12pm", address: null, bookedBy: "Booked by the AI on a call", url: "https://lead96.com/calendar" });
    expect(e.subject).toBe("New visit booked: Maria Lopez, Thu Oct 15, 8am - 12pm");
    expect(e.text).toContain("(214) 555-0142");
    expect(e.html).toContain('href="https://lead96.com/calendar"');
  });
});

describe("pending outcomes email", () => {
  it("counts what is open, lists examples and links the Outcomes page", () => {
    const e = pendingOutcomesEmail({ business: "Cool <Air>", visits: 2, jobs: 1, examples: ["Maria Lopez: Thu Oct 15, 8am - 12pm"], url: "https://lead96.com/outcomes" });
    expect(e.subject).toBe("Cool <Air>: 3 visit results to record");
    expect(e.text).toContain("2 past visits still marked as booked");
    expect(e.text).toContain("1 finished job without won / lost");
    expect(e.html).toContain("Maria Lopez: Thu Oct 15");
    expect(e.html).not.toContain("<Air>");
    expect(e.html).toContain('href="https://lead96.com/outcomes"');
  });
  it("leaves out an empty group", () => {
    const e = pendingOutcomesEmail({ business: "B", visits: 0, jobs: 1, examples: [], url: "https://lead96.com/outcomes" });
    expect(e.subject).toBe("B: 1 visit result to record");
    expect(e.text).not.toContain("past visit");
  });
});

describe("failure alert email", () => {
  it("totals the problems, lists counts and examples, links Admin", () => {
    const e = opsAlertEmail({
      counts: { "Call job": 2, Email: 1 },
      examples: [{ kind: "Call job", at: "2026-10-16T10:00:00Z", message: "Retell <500>", business: "Cool Air HVAC" }],
      windowLabel: "between 9:05 and 10:05 AM ET",
      url: "https://lead96.com/admin/businesses",
    });
    expect(e.subject).toBe("Lead96: 3 problems between 9:05 and 10:05 AM ET");
    expect(e.text).toContain("Call job: 2");
    expect(e.text).toContain("Call job (Cool Air HVAC): Retell <500>");
    expect(e.html).toContain("Retell &lt;500&gt;");
    expect(e.html).toContain('href="https://lead96.com/admin/businesses"');
    expect(opsAlertEmail({ counts: { Text: 1 }, examples: [], windowLabel: "x", url: "u" }).subject).toBe("Lead96: 1 problem x");
  });
});
