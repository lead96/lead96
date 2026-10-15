import "server-only";
import { sendEmail } from "@/lib/email/send";
import { pendingOutcomesEmail, teamBookingEmail, visitEmail, type VisitEmailKind } from "@/lib/email/templates";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createAdminClient>;
type Job = { id: string; workspace_id: string; appointment_id: string | null; kind: VisitEmailKind | "team_new_booking" | "pending_outcomes"; channel: string; attempt: number };
export type NotifyOutcome = { jobId: string; result: "sent" | "skipped" | "retry" | "failed"; reason?: string };

const MAX_ATTEMPTS = 3;
const CUSTOMER_KINDS = new Set(["confirmation", "reminder_24h", "reminder_2h", "rescheduled"]);
const BOOKED_BY: Record<string, string> = { ai_call: "Booked by the AI on a call", ai_text: "Booked by the AI by text", manual: "Booked by your team" };

/** "Thu Oct 15, 8am - 12pm" in the business time zone. */
export function visitWhen(startsAt: string, endsAt: string, timezone: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(startsAt));
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(" ", "").toLowerCase();
  return `${day}, ${t(startsAt)} - ${t(endsAt)}`;
}

async function finish(db: Db, job: Job, status: "sent" | "skipped" | "failed" | "queued", fields: Record<string, unknown> = {}) {
  await db.from("notification_jobs").update({ status, updated_at: new Date().toISOString(), ...fields }).eq("id", job.id);
}

async function ownerEmails(db: Db, workspaceId: string) {
  const { data } = await db.from("workspace_members").select("profiles (email)").eq("workspace_id", workspaceId).eq("role", "owner");
  return ((data ?? []) as unknown as { profiles: { email: string | null } | null }[]).map((o) => o.profiles?.email).filter(Boolean) as string[];
}

type Message = { to: string; subject: string; html: string; text: string; fromName?: string; replyTo?: string };

/** Sends to every address and records the job result (retries errors other than test addresses). */
async function deliver(db: Db, job: Job, messages: Message[]): Promise<{ outcome: NotifyOutcome; sentTo: string[] }> {
  if (!messages.length) {
    await finish(db, job, "skipped", { error: "Nobody to send to." });
    return { outcome: { jobId: job.id, result: "skipped", reason: "no recipient" }, sentTo: [] };
  }
  const sentTo: string[] = [];
  const errors: string[] = [];
  for (const [i, m] of messages.entries()) {
    const r = await sendEmail(m, `visit_${job.id}_${i}`);
    if (r.ok) sentTo.push(m.to);
    else errors.push(r.error);
  }
  if (!sentTo.length) {
    const error = errors.join("; ").slice(0, 500);
    // Test and placeholder addresses never work: no retries for those.
    const permanent = errors.every((e) => /test address|not set/i.test(e));
    if (!permanent && job.attempt < MAX_ATTEMPTS) {
      await finish(db, job, "queued", { error, run_at: new Date(Date.now() + job.attempt * 5 * 60_000).toISOString() });
      return { outcome: { jobId: job.id, result: "retry", reason: error }, sentTo };
    }
    await finish(db, job, permanent ? "skipped" : "failed", { error });
    return { outcome: { jobId: job.id, result: permanent ? "skipped" : "failed", reason: error }, sentTo };
  }
  await finish(db, job, "sent", { sent_to: sentTo.join(", ").slice(0, 500), error: errors.length ? errors.join("; ").slice(0, 500) : null });
  return { outcome: { jobId: job.id, result: "sent" }, sentTo };
}

/** Weekday reminder to the owners: past visits and finished jobs that still have no result. */
async function runPendingOutcomes(db: Db, job: Job): Promise<NotifyOutcome> {
  const [{ data: counts }, { data: ws }, { data: oldest }] = await Promise.all([
    db.rpc("pending_outcome_counts", { p_workspace: job.workspace_id }).maybeSingle<{ visits: number; jobs: number }>(),
    db.from("workspaces").select("name, timezone").eq("id", job.workspace_id).maybeSingle(),
    db
      .from("appointments")
      .select("starts_at, ends_at, customers (full_name, phone)")
      .eq("workspace_id", job.workspace_id)
      .in("status", ["scheduled", "confirmed"])
      .lt("ends_at", new Date(Date.now() - 3_600_000).toISOString())
      .order("starts_at")
      .limit(3),
  ]);
  if (!ws || !counts || counts.visits + counts.jobs === 0) {
    await finish(db, job, "skipped", { error: "Nothing pending any more." });
    return { jobId: job.id, result: "skipped", reason: "nothing pending" };
  }
  const examples = ((oldest ?? []) as unknown as { starts_at: string; ends_at: string; customers: { full_name: string | null; phone: string | null } | null }[]).map(
    (a) => `${a.customers?.full_name || a.customers?.phone || "Customer"}: ${visitWhen(a.starts_at, a.ends_at, ws.timezone)}`,
  );
  const mail = pendingOutcomesEmail({
    business: ws.name,
    visits: counts.visits,
    jobs: counts.jobs,
    examples,
    url: `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/outcomes`,
  });
  const owners = await ownerEmails(db, job.workspace_id);
  return (await deliver(db, job, owners.map((to) => ({ to, ...mail })))).outcome;
}

async function runOne(db: Db, job: Job): Promise<NotifyOutcome> {
  if (job.kind === "pending_outcomes") return runPendingOutcomes(db, job);
  const { data: a } = await db
    .from("appointments")
    .select("id, starts_at, ends_at, status, source, address, customer_id, customers (full_name, email, phone), workspaces (name, phone, timezone)")
    .eq("id", job.appointment_id!)
    .maybeSingle();
  if (!a) {
    await finish(db, job, "skipped", { error: "Visit no longer exists." });
    return { jobId: job.id, result: "skipped", reason: "gone" };
  }
  const appt = a as unknown as {
    starts_at: string;
    ends_at: string;
    status: string;
    source: string;
    address: string | null;
    customer_id: string | null;
    customers: { full_name: string | null; email: string | null; phone: string | null } | null;
    workspaces: { name: string; phone: string | null; timezone: string };
  };
  // A reminder for a visit that was cancelled or already happened is never sent.
  if (CUSTOMER_KINDS.has(job.kind) && !["scheduled", "confirmed"].includes(appt.status)) {
    await finish(db, job, "skipped", { error: `Visit is ${appt.status}.` });
    return { jobId: job.id, result: "skipped", reason: appt.status };
  }
  const ws = appt.workspaces;
  const when = visitWhen(appt.starts_at, appt.ends_at, ws.timezone);
  const owners = await ownerEmails(db, job.workspace_id);

  const messages: Message[] = [];
  if (job.kind === "team_new_booking") {
    const customer = appt.customers?.full_name || appt.customers?.phone || "A customer";
    const mail = teamBookingEmail({
      business: ws.name,
      customer,
      phone: appt.customers?.phone ?? null,
      when,
      address: appt.address,
      bookedBy: BOOKED_BY[appt.source] ?? "Booked",
      url: `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/calendar`,
    });
    for (const to of owners) messages.push({ to, ...mail });
  } else {
    const email = appt.customers?.email;
    if (!email) {
      await finish(db, job, "skipped", { error: "Customer has no email." });
      return { jobId: job.id, result: "skipped", reason: "no email" };
    }
    const name = appt.customers?.full_name?.trim();
    const mail = visitEmail(job.kind as VisitEmailKind, {
      business: ws.name,
      firstName: name ? name.split(/\s+/)[0] : null,
      when,
      address: appt.address,
      businessPhone: ws.phone && /^\+1\d{10}$/.test(ws.phone) ? ws.phone : null,
    });
    messages.push({ to: email, ...mail, fromName: ws.name, replyTo: owners[0] });
  }

  const { outcome, sentTo } = await deliver(db, job, messages);
  if (outcome.result === "sent" && appt.customer_id && job.kind !== "team_new_booking") {
    await db.from("events").insert({
      workspace_id: job.workspace_id,
      type: "email.sent",
      subject_table: "appointments",
      subject_id: job.appointment_id,
      customer_id: appt.customer_id,
      payload: { kind: job.kind, to: sentTo[0], when },
    });
  }
  return outcome;
}

/** Sends every due visit message (called by the per-minute runner). */
export async function runDueNotifications(limit = 20): Promise<NotifyOutcome[]> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("claim_notification_jobs", { p_limit: limit });
  if (error) throw new Error(`Could not claim notification jobs: ${error.message}`);
  const out: NotifyOutcome[] = [];
  for (const job of (data ?? []) as Job[]) {
    try {
      out.push(await runOne(db, job));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await finish(db, job, job.attempt < MAX_ATTEMPTS ? "queued" : "failed", { error: reason.slice(0, 500), run_at: new Date(Date.now() + 5 * 60_000).toISOString() });
      out.push({ jobId: job.id, result: "failed", reason });
    }
  }
  return out;
}
