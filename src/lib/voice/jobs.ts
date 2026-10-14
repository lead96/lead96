import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { leadCallVariables } from "./agent-config";
import { currentAgentConfig } from "./agents";
import { decideCall, retryTime, type CallTrigger } from "./eligibility";
import { createPhoneCall, RetellError } from "./retell";

type Db = ReturnType<typeof createAdminClient>;
type Job = { id: string; workspace_id: string; customer_id: string; lead_id: string | null; trigger: CallTrigger; attempt: number };
export type JobOutcome = { jobId: string; result: "called" | "deferred" | "skipped" | "failed"; reason?: string; callId?: string };

const FORM_SOURCES = new Set(["landing_page", "google", "meta", "website"]);

async function timeline(db: Db, workspaceId: string, customerId: string, type: string, payload: Record<string, unknown>) {
  await db.from("events").insert({ workspace_id: workspaceId, type, subject_table: "customers", subject_id: customerId, customer_id: customerId, payload });
}

/**
 * A new form lead arrived: queue an AI call and run it right away (fast callback). Does nothing
 * when the business has automatic calls off. Never throws (runs after the lead is saved).
 */
export async function queueFastCallback(leadId: string): Promise<JobOutcome | null> {
  try {
    const db = createAdminClient();
    const { data: lead } = await db.from("leads").select("id, workspace_id, customer_id, kind, source").eq("id", leadId).maybeSingle();
    if (!lead || lead.kind !== "form" || !FORM_SOURCES.has(lead.source)) return null;
    const { data: agent } = await db.from("voice_agents").select("auto_call").eq("workspace_id", lead.workspace_id).maybeSingle();
    if (!agent?.auto_call) return null;

    const { data: job, error } = await db
      .from("call_jobs")
      .insert({ workspace_id: lead.workspace_id, customer_id: lead.customer_id, lead_id: lead.id, trigger: "fast_callback", status: "running" })
      .select("id, workspace_id, customer_id, lead_id, trigger, attempt")
      .single();
    // A job is already open for this person (duplicate lead): that call covers it.
    if (error || !job) return null;
    return await runJob(db, job as Job);
  } catch (e) {
    console.error("Fast callback failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Runs every due job (called by the per-minute scheduler). */
export async function runDueJobs(limit = 10): Promise<JobOutcome[]> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("claim_call_jobs", { p_limit: limit });
  if (error) throw new Error(`Could not claim call jobs: ${error.message}`);
  const out: JobOutcome[] = [];
  for (const job of (data ?? []) as Job[]) out.push(await runJob(db, job));
  return out;
}

async function finishJob(db: Db, jobId: string, status: "done" | "skipped" | "failed" | "queued", fields: Record<string, unknown> = {}) {
  await db.from("call_jobs").update({ status, updated_at: new Date().toISOString(), ...fields }).eq("id", jobId);
}

/** Decides and (if allowed) places one AI call for a claimed job. */
export async function runJob(db: Db, job: Job): Promise<JobOutcome> {
  const [ws, agent, number, customer, lead, profile, last] = await Promise.all([
    db.from("workspaces").select("timezone").eq("id", job.workspace_id).single(),
    db.from("voice_agents").select("retell_agent_id, auto_call").eq("workspace_id", job.workspace_id).maybeSingle(),
    db.from("phone_numbers").select("e164").eq("workspace_id", job.workspace_id).order("created_at").limit(1).maybeSingle(),
    db.from("customers").select("status, do_not_call, phone, full_name").eq("id", job.customer_id).single(),
    job.lead_id
      ? db.from("leads").select("kind, source, phone, zip, consent_given, full_name, service").eq("id", job.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("demand_profiles").select("zip_codes, excluded_zip_codes").eq("workspace_id", job.workspace_id).maybeSingle(),
    db
      .from("calls")
      .select("created_at")
      .eq("customer_id", job.customer_id)
      .eq("direction", "outbound")
      .neq("trigger", "test")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!customer.data) {
    await finishJob(db, job.id, "skipped", { reason: "Customer no longer exists." });
    return { jobId: job.id, result: "skipped", reason: "Customer no longer exists." };
  }

  const excluded = new Set<string>(profile.data?.excluded_zip_codes ?? []);
  const decision = decideCall({
    now: new Date(),
    timezone: ws.data?.timezone ?? "America/New_York",
    trigger: job.trigger,
    autoCall: Boolean(agent.data?.auto_call),
    agentReady: Boolean(agent.data?.retell_agent_id),
    fromNumber: number.data?.e164 ?? null,
    lead: lead.data,
    customer: customer.data,
    serviceZips: (profile.data?.zip_codes ?? []).filter((z: string) => !excluded.has(z)),
    lastOutboundCallAt: last.data ? new Date(last.data.created_at) : null,
  });

  if (!decision.ok && !decision.skip) {
    await finishJob(db, job.id, "queued", { run_at: decision.retryAt.toISOString(), reason: decision.reason });
    return { jobId: job.id, result: "deferred", reason: decision.reason };
  }
  if (!decision.ok) {
    await finishJob(db, job.id, "skipped", { reason: decision.reason });
    await timeline(db, job.workspace_id, job.customer_id, "call.skipped", { reason: decision.reason, trigger: job.trigger });
    return { jobId: job.id, result: "skipped", reason: decision.reason };
  }

  const config = await currentAgentConfig(job.workspace_id);
  const { data: callRow, error: insertError } = await db
    .from("calls")
    .insert({
      workspace_id: job.workspace_id,
      customer_id: job.customer_id,
      lead_id: job.lead_id,
      job_id: job.id,
      direction: "outbound",
      trigger: job.trigger,
      attempt: job.attempt,
      from_number: number.data!.e164,
      to_number: decision.toNumber,
      status: "queued",
    })
    .select("id")
    .single();
  if (insertError || !callRow) {
    await finishJob(db, job.id, "queued", { reason: "Could not save the call; retrying." });
    return { jobId: job.id, result: "failed", reason: insertError?.message };
  }

  const serviceLabel = lead.data?.service
    ? ((await db.from("taxonomy_values").select("label").eq("category", "service").eq("value", lead.data.service).limit(1).maybeSingle()).data?.label ?? null)
    : null;
  try {
    const call = await createPhoneCall({
      from: number.data!.e164,
      to: decision.toNumber,
      agentId: agent.data!.retell_agent_id!,
      variables: config
        ? { ...leadCallVariables(config, { full_name: lead.data?.full_name ?? customer.data.full_name, service: lead.data?.service ?? null, zip: lead.data?.zip ?? null, source: lead.data?.source ?? "manual", serviceLabel, known: Boolean(last.data) }) }
        : {},
      metadata: { workspace_id: job.workspace_id, customer_id: job.customer_id, lead_id: job.lead_id ?? "", call_row_id: callRow.id, trigger: job.trigger },
      idempotencyKey: `job_${job.id}`,
    });
    // Retell's call_started webhook can arrive first: never move the status backwards.
    await db.from("calls").update({ provider_call_id: call.call_id, agent_version: call.agent_version ?? null, updated_at: new Date().toISOString() }).eq("id", callRow.id);
    await db.from("calls").update({ status: call.call_status }).eq("id", callRow.id).eq("status", "queued");
    await finishJob(db, job.id, "done", { call_id: callRow.id, reason: null });
    return { jobId: job.id, result: "called", callId: callRow.id };
  } catch (e) {
    const reason = e instanceof RetellError ? e.message : e instanceof Error ? e.message : "Could not place the call.";
    await db.from("calls").update({ status: "error", error: reason.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", callRow.id);
    await finishJob(db, job.id, "failed", { call_id: callRow.id, reason: reason.slice(0, 500) });
    await timeline(db, job.workspace_id, job.customer_id, "call.failed", { reason: reason.slice(0, 300), trigger: job.trigger });
    return { jobId: job.id, result: "failed", reason };
  }
}

/** After no answer / voicemail on an automatic call: plan the next attempt (if any are left). */
export async function scheduleRetry(db: Db, call: { workspace_id: string; customer_id: string | null; lead_id: string | null; trigger: string; attempt: number; outcome: string | null }) {
  if (!call.customer_id || !["fast_callback", "retry"].includes(call.trigger) || !["no_answer", "voicemail"].includes(call.outcome ?? "")) return null;
  const at = retryTime(call.attempt, new Date());
  if (!at) return null;
  const { data } = await db
    .from("call_jobs")
    .insert({ workspace_id: call.workspace_id, customer_id: call.customer_id, lead_id: call.lead_id, trigger: "retry", attempt: call.attempt + 1, run_at: at.toISOString() })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/** A team member asked the AI to call this customer now (same consent, area, DNC and hours rules). */
export async function startManualCall(workspaceId: string, customerId: string): Promise<JobOutcome | { result: "busy"; reason: string }> {
  const db = createAdminClient();
  // Consent comes from the person's own leads: use the latest one that gave it, else the latest.
  const { data: leads } = await db
    .from("leads")
    .select("id, consent_given")
    .eq("customer_id", customerId)
    .eq("workspace_id", workspaceId)
    .order("received_at", { ascending: false })
    .limit(20);
  const lead = (leads ?? []).find((l) => l.consent_given) ?? leads?.[0] ?? null;
  const { data: job, error } = await db
    .from("call_jobs")
    .insert({ workspace_id: workspaceId, customer_id: customerId, lead_id: lead?.id ?? null, trigger: "manual", status: "running" })
    .select("id, workspace_id, customer_id, lead_id, trigger, attempt")
    .single();
  if (error || !job) return { result: "busy", reason: "A call to this customer is already planned or in progress." };
  return runJob(db, job as Job);
}
