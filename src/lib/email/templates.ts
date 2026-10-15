/**
 * App email content (HTML + plain text). Same look as the Supabase auth templates in
 * supabase/templates/. Pure - unit-tested.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const BUTTON =
  "display:inline-block;padding:10px 18px;background:#3b82f6;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600";
const NOTE = "color:#64748b;font-size:13px";

export function inviteEmail(p: { team: string; inviter: string | null; role: "owner" | "staff"; url: string }) {
  const who = p.inviter ? `${p.inviter} invited you` : "You've been invited";
  const role = p.role === "owner" ? "an owner" : "a team member";
  const subject = `Join ${p.team} on Lead96`;
  const html = [
    `<h2>Join ${esc(p.team)} on Lead96</h2>`,
    `<p>${esc(who)} to join ${esc(p.team)} as ${role}. Lead96 is where the team works its leads, calls and appointments.</p>`,
    `<p><a href="${esc(p.url)}" style="${BUTTON}">Accept invite</a></p>`,
    `<p style="${NOTE}">Or open this link: ${esc(p.url)}</p>`,
    `<p style="${NOTE}">Sign up or sign in with this email address to accept. If you weren't expecting this, you can ignore this email.</p>`,
  ].join("\n");
  const text = [
    `${who} to join ${p.team} as ${role} on Lead96.`,
    "",
    `Accept the invite: ${p.url}`,
    "",
    "Sign up or sign in with this email address to accept. If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  return { subject, html, text };
}

export type VisitEmailKind = "confirmation" | "reminder_24h" | "reminder_2h" | "rescheduled" | "cancelled";

const prettyPhone = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

/** Emails to the customer about their visit. Sent from the business name; replies go to the business. */
export function visitEmail(
  kind: VisitEmailKind,
  p: { business: string; firstName: string | null; when: string; address: string | null; businessPhone: string | null },
) {
  const hi = p.firstName ? `Hi ${p.firstName},` : "Hi,";
  const call = p.businessPhone ? ` call us at ${prettyPhone(p.businessPhone)}` : " reply to this email";
  const lines: Record<VisitEmailKind, { subject: string; intro: string; after: string }> = {
    confirmation: {
      subject: `Your visit with ${p.business} is booked: ${p.when}`,
      intro: `your visit with ${p.business} is booked. Our technician will arrive in this window:`,
      after: `We will remind you before the visit. Need to change it?${call ? ` Just${call}.` : ""}`,
    },
    reminder_24h: {
      subject: `Reminder: ${p.business} visit tomorrow, ${p.when}`,
      intro: `a reminder that ${p.business} will visit you tomorrow in this window:`,
      after: `Need to change it?${call ? ` Just${call}.` : ""}`,
    },
    reminder_2h: {
      subject: `${p.business} arrives soon: ${p.when}`,
      intro: `our technician from ${p.business} is coming in this window:`,
      after: `Please make sure someone is home. Questions?${call ? ` Just${call}.` : ""}`,
    },
    rescheduled: {
      subject: `Your ${p.business} visit was moved: ${p.when}`,
      intro: `your visit with ${p.business} was moved to a new window:`,
      after: `If this does not suit you,${call}.`,
    },
    cancelled: {
      subject: `Your ${p.business} visit was cancelled`,
      intro: `your visit with ${p.business} on ${p.when} was cancelled.`,
      after: `To book a new time,${call}.`,
    },
  };
  const l = lines[kind];
  const showWindow = kind !== "cancelled";
  const html = [
    `<p>${esc(hi)}</p>`,
    `<p>${esc(l.intro)}</p>`,
    showWindow ? `<p style="font-size:17px;font-weight:600;margin:12px 0">${esc(p.when)}</p>` : "",
    showWindow && p.address ? `<p>${esc(p.address)}</p>` : "",
    `<p>${esc(l.after)}</p>`,
    `<p style="${NOTE}">${esc(p.business)}. You get this email because you booked a visit.</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  const text = [hi, "", l.intro, ...(showWindow ? ["", p.when, ...(p.address ? [p.address] : [])] : []), "", l.after, "", `${p.business}. You get this email because you booked a visit.`].join("\n");
  return { subject: l.subject, html, text };
}

/** To the business owners when a visit is booked (so nobody misses one the AI booked at night). */
export function teamBookingEmail(p: { business: string; customer: string; phone: string | null; when: string; address: string | null; bookedBy: string; url: string }) {
  const subject = `New visit booked: ${p.customer}, ${p.when}`;
  const details = [p.customer, p.phone ? prettyPhone(p.phone) : null, p.address].filter(Boolean) as string[];
  const html = [
    `<h2>New visit booked</h2>`,
    `<p style="font-size:17px;font-weight:600;margin:12px 0">${esc(p.when)}</p>`,
    `<p>${details.map(esc).join("<br>")}</p>`,
    `<p style="${NOTE}">${esc(p.bookedBy)}</p>`,
    `<p><a href="${esc(p.url)}" style="${BUTTON}">Open calendar</a></p>`,
  ].join("\n");
  const text = [`New visit booked for ${p.business}`, "", p.when, ...details, "", p.bookedBy, "", `Open calendar: ${p.url}`].join("\n");
  return { subject, html, text };
}

/** To the business owners on weekday mornings while past visits or finished jobs have no result. */
export function pendingOutcomesEmail(p: { business: string; visits: number; jobs: number; examples: string[]; url: string }) {
  const parts = [
    p.visits ? `${p.visits} past visit${p.visits === 1 ? "" : "s"} still marked as booked` : null,
    p.jobs ? `${p.jobs} finished job${p.jobs === 1 ? "" : "s"} without won / lost` : null,
  ].filter(Boolean) as string[];
  const total = p.visits + p.jobs;
  const subject = `${p.business}: ${total} visit result${total === 1 ? "" : "s"} to record`;
  const html = [
    `<h2>Visit results to record</h2>`,
    `<p>${parts.map(esc).join("<br>")}</p>`,
    p.examples.length ? `<p style="${NOTE}">${p.examples.map(esc).join("<br>")}</p>` : "",
    `<p>It takes a few seconds per visit, and it is what shows which ads bring paying jobs.</p>`,
    `<p><a href="${esc(p.url)}" style="${BUTTON}">Record results</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");
  const text = [`Visit results to record for ${p.business}`, "", ...parts, ...(p.examples.length ? ["", ...p.examples] : []), "", `Record results: ${p.url}`].join("\n");
  return { subject, html, text };
}
