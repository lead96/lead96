import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { statusAfterCall } from "./calls";
import { decideText } from "./eligibility";
import { createSmsChat, RetellError, type RetellChat } from "./retell";
import { noAnswerText } from "./sms-config";

type Db = ReturnType<typeof createAdminClient>;

async function timeline(db: Db, workspaceId: string, customerId: string, type: string, subjectId: string, payload: Record<string, unknown>) {
  await db.from("events").insert({ workspace_id: workspaceId, type, subject_table: "messages", subject_id: subjectId, customer_id: customerId, payload });
}

/**
 * After the first automatic AI call goes unanswered: one text from the business number, so the lead
 * can reply instead of picking up. Once per call; at most one text conversation per person per day.
 */
export async function sendNoAnswerText(db: Db, call: { id: string; workspace_id: string; customer_id: string | null; lead_id: string | null }) {
  if (!call.customer_id) return null;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("call_id", call.id);
  if (count) return null; // call_ended and call_analyzed both arrive: text once

  const [ws, agent, number, customer, lead, last] = await Promise.all([
    db.from("workspaces").select("name, timezone, phone, vertical").eq("id", call.workspace_id).single(),
    db.from("voice_agents").select("retell_chat_agent_id").eq("workspace_id", call.workspace_id).maybeSingle(),
    db.from("phone_numbers").select("e164").eq("workspace_id", call.workspace_id).order("created_at").limit(1).maybeSingle(),
    db.from("customers").select("do_not_call, phone, full_name, service, zip").eq("id", call.customer_id).single(),
    call.lead_id ? db.from("leads").select("source, consent_given, service").eq("id", call.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("messages").select("created_at").eq("customer_id", call.customer_id).neq("status", "skipped").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!customer.data) return null;

  const decision = decideText({
    now: new Date(),
    timezone: ws.data?.timezone ?? "America/New_York",
    smsReady: Boolean(agent.data?.retell_chat_agent_id),
    fromNumber: number.data?.e164 ?? null,
    lead: lead.data,
    customer: customer.data,
    lastTextAt: last.data ? new Date(last.data.created_at) : null,
  });
  const base = { workspace_id: call.workspace_id, customer_id: call.customer_id, lead_id: call.lead_id, call_id: call.id, reason: "no_answer" as const };
  if (!decision.ok) {
    await db.from("messages").insert({ ...base, status: "skipped", error: decision.reason });
    return null;
  }

  const service = lead.data?.service ?? customer.data.service;
  const serviceLabel = service
    ? ((await db.from("taxonomy_values").select("label").eq("vertical", ws.data?.vertical ?? "hvac").eq("category", "service").eq("value", service).maybeSingle()).data?.label ?? null)
    : null;
  const name = customer.data.full_name?.trim() || null;
  const body = noAnswerText({
    businessName: ws.data?.name ?? "the business",
    firstName: name ? name.split(/\s+/)[0] : null,
    serviceLabel,
    callbackNumber: ws.data?.phone && /^\+1\d{10}$/.test(ws.data.phone) ? ws.data.phone : number.data!.e164,
  });
  const { data: row } = await db
    .from("messages")
    .insert({ ...base, status: "queued", from_number: number.data!.e164, to_number: decision.toNumber, body })
    .select("id")
    .single();
  if (!row) return null;

  try {
    const chat = await createSmsChat({
      from: number.data!.e164,
      to: decision.toNumber,
      agentId: agent.data!.retell_chat_agent_id!,
      variables: { sms_opening: body, lead_name: name ?? "unknown", lead_service: serviceLabel?.toLowerCase() ?? "service", lead_zip: customer.data.zip ?? "unknown" },
      metadata: { workspace_id: call.workspace_id, customer_id: call.customer_id, message_row_id: row.id, kind: "sms" },
    });
    await db.from("messages").update({ provider_chat_id: chat.chat_id, status: "sent", updated_at: new Date().toISOString() }).eq("id", row.id);
    await timeline(db, call.workspace_id, call.customer_id, "sms.sent", row.id, { body, reason: "no_answer" });
    return row.id;
  } catch (e) {
    const error = e instanceof RetellError ? e.message : e instanceof Error ? e.message : "Could not send the text.";
    await db.from("messages").update({ status: "failed", error: error.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", row.id);
    await timeline(db, call.workspace_id, call.customer_id, "sms.failed", row.id, { reason: error.slice(0, 300) });
    return null;
  }
}

const OUTCOMES = new Set(["qualified", "callback", "not_interested", "wrong_number", "do_not_call", "other"]);

/** Retell chat_started / chat_ended / chat_analyzed for our text conversations. */
export async function handleChatEvent(event: string, chat: RetellChat): Promise<{ workspaceId: string | null; status: "processed" | "duplicate" | "rejected"; error?: string }> {
  const db = createAdminClient();
  const meta = (chat.metadata && typeof chat.metadata === "object" ? chat.metadata : {}) as Record<string, unknown>;
  let { data: row } = await db.from("messages").select("id, workspace_id, customer_id, replied, summary").eq("provider_chat_id", chat.chat_id).maybeSingle();
  if (!row && typeof meta.message_row_id === "string") {
    row = (await db.from("messages").select("id, workspace_id, customer_id, replied, summary").eq("id", meta.message_row_id).maybeSingle()).data;
  }
  if (!row) return { workspaceId: null, status: "rejected", error: "Unknown text conversation." };
  if (row.summary && event !== "chat_analyzed") return { workspaceId: row.workspace_id, status: "duplicate" };

  const transcript = (chat.message_with_tool_calls ?? [])
    .filter((m) => (m.role === "agent" || m.role === "user") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role as "agent" | "user", content: m.content!.slice(0, 2000) }));
  const replied = transcript.some((m) => m.role === "user");
  const analysis = (chat.chat_analysis?.custom_analysis_data ?? {}) as Record<string, unknown>;
  await db
    .from("messages")
    .update({
      provider_chat_id: chat.chat_id,
      status: chat.chat_status === "ended" ? "ended" : chat.chat_status === "error" ? "failed" : "ongoing",
      ...(transcript.length ? { transcript } : {}),
      replied: replied || row.replied,
      ...(chat.chat_analysis?.chat_summary ? { summary: chat.chat_analysis.chat_summary.slice(0, 2000) } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (event === "chat_analyzed" && row.customer_id && !row.summary) {
    const outcome = typeof analysis.outcome === "string" && OUTCOMES.has(analysis.outcome) ? analysis.outcome : null;
    if (replied) {
      await timeline(db, row.workspace_id, row.customer_id, "sms.replied", row.id, {
        summary: chat.chat_analysis?.chat_summary ?? null,
        outcome,
        preferred_window: typeof analysis.preferred_window === "string" ? analysis.preferred_window : null,
      });
    }
    const { data: customer } = await db.from("customers").select("status, do_not_call").eq("id", row.customer_id).single();
    if (customer && (analysis.opt_out === true || outcome === "do_not_call") && !customer.do_not_call) {
      await db.from("customers").update({ do_not_call: true, do_not_call_at: new Date().toISOString() }).eq("id", row.customer_id);
      await db.from("events").insert({
        workspace_id: row.workspace_id,
        type: "customer.do_not_call",
        subject_table: "customers",
        subject_id: row.customer_id,
        customer_id: row.customer_id,
        payload: { reason: "Asked by text not to be contacted again" },
      });
    }
    const next = customer && replied ? statusAfterCall(customer.status, (outcome ?? "other") as Parameters<typeof statusAfterCall>[1]) : null;
    if (next) {
      await db.from("customers").update({ status: next }).eq("id", row.customer_id);
      await db.from("events").insert({
        workspace_id: row.workspace_id,
        type: "customer.status_changed",
        subject_table: "customers",
        subject_id: row.customer_id,
        customer_id: row.customer_id,
        payload: { from: customer!.status, to: next, reason: "Replied to a text" },
      });
    }
  }
  return { workspaceId: row.workspace_id, status: "processed" };
}
