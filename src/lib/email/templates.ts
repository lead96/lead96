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
