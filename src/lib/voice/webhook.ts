import "server-only";
import { ingestLead } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/server";
import { callMetadata, callRowFromRetell, OUTCOME_LABELS, statusAfterCall, withBooking, type CallRowUpdate, type RetellCall } from "./calls";
import { scheduleRetry } from "./jobs";
import { sendNoAnswerText } from "./texts";

type Db = ReturnType<typeof createAdminClient>;
export type RetellEvent = { event: string; call: RetellCall };
export type HandleResult = { workspaceId: string | null; callRowId: string | null; status: "processed" | "duplicate" | "rejected"; error?: string };

const HANDLED = new Set(["call_started", "call_ended", "call_analyzed"]);

/** Which business a call belongs to: our metadata first, then the number dialed, then the agent. */
export async function findWorkspace(db: Db, call: RetellCall): Promise<string | null> {
  const meta = callMetadata(call);
  if (meta.workspace_id) return meta.workspace_id;
  if (call.direction === "inbound" && call.to_number) {
    const { data } = await db.from("phone_numbers").select("workspace_id").eq("e164", call.to_number).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  if (call.agent_id) {
    const { data } = await db.from("voice_agents").select("workspace_id").eq("retell_agent_id", call.agent_id).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  return null;
}

/** Fields Retell has sent so far (call_started has no transcript yet; never overwrite with null). */
function present(u: CallRowUpdate) {
  return Object.fromEntries(Object.entries(u).filter(([, v]) => v !== null && v !== undefined && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)));
}

export async function handleRetellEvent(e: RetellEvent): Promise<HandleResult> {
  if (!HANDLED.has(e.event)) return { workspaceId: null, callRowId: null, status: "duplicate" };
  const db = createAdminClient();
  const call = e.call;
  const workspaceId = await findWorkspace(db, call);
  if (!workspaceId) return { workspaceId: null, callRowId: null, status: "rejected", error: "No business for this call (unknown number and agent)." };

  const meta = callMetadata(call);
  const raw = callRowFromRetell(call);
  const { data: existing } = await db
    .from("calls")
    .select("id, customer_id, lead_id, outcome, summary, status, appointment")
    .eq("provider_call_id", call.call_id)
    .maybeSingle();
  // Retell retries and orders events; once analyzed, later copies change nothing.
  if (existing?.summary && e.event !== "call_analyzed") return { workspaceId, callRowId: existing.id, status: "duplicate" };

  let row = existing ?? null;
  if (!row && meta.call_row_id) {
    const { data } = await db.from("calls").select("id, customer_id, lead_id, outcome, summary, status, appointment").eq("id", meta.call_row_id).eq("workspace_id", workspaceId).maybeSingle();
    row = data;
  }
  // A visit window saved during the call (book_appointment tool) makes the call "booked".
  const update = withBooking(raw, Boolean(row?.appointment));

  const direction: "inbound" | "outbound" = call.direction === "inbound" ? "inbound" : "outbound";
  const trigger = meta.trigger ?? (direction === "inbound" ? "inbound" : call.call_type === "web_call" ? "test" : "manual");
  let customerId = row?.customer_id ?? meta.customer_id ?? null;
  let leadId = row?.lead_id ?? meta.lead_id ?? null;

  // An inbound call is a lead of its own (kind "call"); the caller becomes or matches a customer.
  if (direction === "inbound" && !leadId && call.from_number && e.event !== "call_started") {
    const res = await ingestLead({
      workspace_id: workspaceId,
      kind: "call",
      source: "call",
      external_id: `retell_${call.call_id}`,
      phone: call.from_number,
      full_name: null,
      message: update.summary,
      fields: { call_status: call.call_status, duration_seconds: update.duration_seconds ?? 0, answered_by: "ai", dialed_number: call.to_number ?? null },
      received_at: update.started_at ?? undefined,
    });
    if (res.ok) {
      customerId = res.customerId;
      leadId = res.leadId;
    }
  }

  const fields = { ...present(update), direction, customer_id: customerId, lead_id: leadId, updated_at: new Date().toISOString() };
  let callRowId: string;
  if (row) {
    const { error } = await db.from("calls").update({ ...fields, provider_call_id: call.call_id }).eq("id", row.id);
    if (error) throw new Error(`Could not save call: ${error.message}`);
    callRowId = row.id;
  } else {
    const { data, error } = await db
      .from("calls")
      .upsert({ ...fields, workspace_id: workspaceId, provider_call_id: call.call_id, trigger }, { onConflict: "provider_call_id" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Could not save call: ${error?.message}`);
    callRowId = data.id;
  }

  // Calls that never connected get no analysis, so they are finished on call_ended.
  const final = e.event === "call_analyzed" || (e.event === "call_ended" && call.call_status === "not_connected");
  if (final) await afterAnalyzed(db, { workspaceId, callRowId, customerId, update, call });
  if (e.event !== "call_started" && (update.outcome === "no_answer" || update.outcome === "voicemail")) {
    const { data: c } = await db.from("calls").select("trigger, attempt, lead_id").eq("id", callRowId).single();
    // One open job per customer (unique index), so call_ended + call_analyzed plan one retry.
    if (c) await scheduleRetry(db, { workspace_id: workspaceId, customer_id: customerId, lead_id: c.lead_id, trigger: c.trigger, attempt: c.attempt, outcome: update.outcome });
    // The first automatic call went unanswered: text them so they can reply instead (once per call).
    if (c?.trigger === "fast_callback" && c.attempt === 1) await sendNoAnswerText(db, { id: callRowId, workspace_id: workspaceId, customer_id: customerId, lead_id: c.lead_id });
  }
  return { workspaceId, callRowId, status: "processed" };
}

/** Timeline event, customer status, do-not-call flag and voice usage, once per call. */
async function afterAnalyzed(
  db: Db,
  p: { workspaceId: string; callRowId: string; customerId: string | null; update: CallRowUpdate; call: RetellCall },
) {
  const { workspaceId, callRowId, customerId, update } = p;
  const { count } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("type", "call.completed")
    .eq("subject_id", callRowId);
  if (count) return;

  await db.from("events").insert({
    workspace_id: workspaceId,
    type: "call.completed",
    subject_table: "calls",
    subject_id: callRowId,
    customer_id: customerId,
    payload: {
      outcome: update.outcome,
      direction: update.direction ?? null,
      duration_seconds: update.duration_seconds,
      summary: update.summary,
      needs_review: update.needs_review,
    },
  });

  const minutes = Math.round(((update.duration_seconds ?? 0) / 60) * 100) / 100;
  if (minutes > 0)
    await db.from("usage_records").insert({
      workspace_id: workspaceId,
      kind: "voice_minutes",
      feature: "ai_call",
      quantity: minutes,
      model: "retell",
      metadata: { call_id: p.call.call_id, cost_usd: update.cost_usd },
    });

  if (!customerId) return;
  const { data: customer } = await db.from("customers").select("status, do_not_call").eq("id", customerId).maybeSingle();
  if (!customer) return;

  if (update.outcome === "do_not_call" && !customer.do_not_call) {
    await db.from("customers").update({ do_not_call: true, do_not_call_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", customerId);
    await db.from("events").insert({
      workspace_id: workspaceId,
      type: "customer.do_not_call",
      subject_table: "customers",
      subject_id: customerId,
      customer_id: customerId,
      payload: { reason: "Asked on an AI call not to be called again", call_id: callRowId },
    });
  }

  const next = statusAfterCall(customer.status, update.outcome);
  if (next) {
    await db.from("customers").update({ status: next, updated_at: new Date().toISOString() }).eq("id", customerId);
    await db.from("events").insert({
      workspace_id: workspaceId,
      type: "customer.status_changed",
      subject_table: "customers",
      subject_id: customerId,
      customer_id: customerId,
      payload: { from: customer.status, to: next, reason: `AI call: ${OUTCOME_LABELS[update.outcome!]}` },
    });
  }
}

/** Copies the call recording into our storage (Retell's URL is temporary). Never throws. */
export async function storeRecording(workspaceId: string, callRowId: string, url: string | undefined) {
  if (!url || !/^https:\/\//.test(url)) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const type = res.headers.get("content-type")?.split(";")[0] || "audio/wav";
    const ext = type.includes("mpeg") ? "mp3" : "wav";
    const path = `${workspaceId}/${callRowId}.${ext}`;
    const db = createAdminClient();
    const { error } = await db.storage.from("call-recordings").upload(path, await res.arrayBuffer(), { contentType: type === "audio/x-wav" ? "audio/wav" : type, upsert: true });
    if (error) throw new Error(error.message);
    await db.from("calls").update({ recording_path: path }).eq("id", callRowId);
  } catch (e) {
    console.error("Recording not stored:", e instanceof Error ? e.message : e);
  }
}
