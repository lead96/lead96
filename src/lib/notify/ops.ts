import "server-only";
import { sendEmail } from "@/lib/email/send";
import { opsAlertEmail } from "@/lib/email/templates";
import { publicEnv, serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Failure alerts (migration 032): the hourly planner queues an ops_alerts row when something
 * failed; the per-minute runner calls this to email it to every platform admin.
 */

type Alert = { id: string; window_from: string; window_to: string; counts: Record<string, number>; examples: { kind: string; at: string; message: string; business: string | null }[]; attempt: number };

const MAX_ATTEMPTS = 3;
const TZ = "America/New_York";

/** "between 9:05 and 10:05 AM ET" */
export function windowLabel(from: string, to: string) {
  const t = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `between ${t(from).replace(/ [AP]M$/, "")} and ${t(to)} ET`;
}

export async function runDueOpsAlerts() {
  const db = createAdminClient();
  const { data, error } = await db.rpc("claim_ops_alerts");
  if (error) throw new Error(`Could not claim alerts: ${error.message}`);
  const alerts = (data ?? []) as Alert[];
  if (!alerts.length) return [];
  // OPS_ALERT_EMAILS (comma-separated) replaces the default: every platform admin.
  const configured = (serverEnv().OPS_ALERT_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const { data: admins } = configured.length ? { data: [] } : await db.from("profiles").select("email").eq("is_platform_admin", true);
  const to = [...new Set(configured.length ? configured : (admins ?? []).map((a) => a.email).filter(Boolean))] as string[];
  const out: { id: string; result: string }[] = [];
  for (const a of alerts) {
    const mail = opsAlertEmail({ counts: a.counts, examples: a.examples, windowLabel: windowLabel(a.window_from, a.window_to), url: `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/admin/businesses` });
    const sent: string[] = [];
    const errors: string[] = [];
    for (const [i, address] of to.entries()) {
      const r = await sendEmail({ to: address, ...mail }, `ops_${a.id}_${i}`);
      if (r.ok) sent.push(address);
      else if (!/test address/.test(r.error)) errors.push(r.error);
    }
    const status = sent.length ? "sent" : errors.length && a.attempt < MAX_ATTEMPTS ? "queued" : errors.length ? "failed" : "skipped";
    await db
      .from("ops_alerts")
      .update({ status, sent_to: sent.join(", ").slice(0, 500) || null, error: errors.join("; ").slice(0, 500) || null, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    out.push({ id: a.id, result: status });
  }
  return out;
}
