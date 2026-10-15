import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { bookWindow, openWindowsFor } from "@/lib/calendar/service";
import { ingestLead } from "@/lib/leads/ingest";
import { callMetadata, type RetellCall } from "./calls";
import { findWorkspace } from "./webhook";

/**
 * Tools the AI uses during a call (Retell custom functions). The answer is read by the AI, so it is
 * short, factual JSON. Windows come from the Lead96 calendar (visit hours, capacity, bookings, blocked
 * days) and a booking is a real appointment, re-checked under a lock in the database.
 */
export type ToolRequest = { name: string; call: RetellCall; args: Record<string, unknown> };
export type ToolResult = { status: number; body: Record<string, unknown> };

type Db = ReturnType<typeof createAdminClient>;

async function checkAvailability(db: Db, workspaceId: string): Promise<ToolResult> {
  const windows = await openWindowsFor(db, workspaceId, 5);
  if (!windows.length) {
    return { status: 200, body: { windows: [], instruction: "There are no open visit windows in the next days. Note their preferred day and time and say the team will call to schedule." } };
  }
  return {
    status: 200,
    body: {
      windows: windows.map((w) => ({ date: w.date, start: w.start, end: w.end, say: w.label })),
      instruction: "Offer two or three of these. Use date, start and end exactly as given when you call book_appointment.",
    },
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The call row and the customer this call belongs to (an unknown inbound caller becomes a customer now). */
async function callAndCustomer(db: Db, workspaceId: string, call: RetellCall) {
  const meta = callMetadata(call);
  let { data: row } = await db.from("calls").select("id, customer_id, lead_id").eq("provider_call_id", call.call_id).maybeSingle();
  if (!row && meta.call_row_id) row = (await db.from("calls").select("id, customer_id, lead_id").eq("id", meta.call_row_id).eq("workspace_id", workspaceId).maybeSingle()).data;
  const inbound = call.direction === "inbound";
  if (!row) {
    row = (
      await db
        .from("calls")
        .upsert(
          { workspace_id: workspaceId, provider_call_id: call.call_id, direction: inbound ? "inbound" : "outbound", trigger: meta.trigger ?? (inbound ? "inbound" : "manual"), status: "ongoing", from_number: call.from_number ?? null, to_number: call.to_number ?? null },
          { onConflict: "provider_call_id" },
        )
        .select("id, customer_id, lead_id")
        .single()
    ).data;
  }
  if (!row) return null;
  let customerId = row.customer_id ?? meta.customer_id ?? null;
  let leadId = row.lead_id ?? meta.lead_id ?? null;
  if (!customerId && inbound && call.from_number) {
    // Same lead id the call webhook uses later, so the call ends up as one lead.
    const r = await ingestLead({ workspace_id: workspaceId, kind: "call", source: "call", external_id: `retell_${call.call_id}`, phone: call.from_number, fields: { answered_by: "ai" } });
    if (r.ok) {
      customerId = r.customerId;
      leadId = r.leadId;
      await db.from("calls").update({ customer_id: customerId, lead_id: leadId }).eq("id", row.id);
    }
  }
  return { callId: row.id, customerId, leadId };
}

async function bookAppointment(db: Db, workspaceId: string, call: RetellCall, args: Record<string, unknown>): Promise<ToolResult> {
  const who = await callAndCustomer(db, workspaceId, call);
  if (!who) return { status: 500, body: { ok: false } };
  const address = str(args.address, 200) || null;
  const notes = str(args.notes, 500) || null;
  const r = await bookWindow(db, {
    workspaceId,
    date: str(args.date, 10),
    start: str(args.start, 5),
    end: str(args.end, 5),
    customerId: who.customerId,
    leadId: who.leadId,
    callId: who.callId,
    source: "ai_call",
    service: str(call.retell_llm_dynamic_variables?.lead_service, 80) || null,
    address,
    notes,
  });
  if (!r.ok) {
    return {
      status: 200,
      body: {
        ok: false,
        instruction:
          r.reason === "not_open" || r.reason === "full" || r.reason === "day_full" || r.reason === "blocked"
            ? "That window is no longer open. Call check_availability again and offer one of the windows it returns."
            : "The schedule is not available right now. Note their preferred day and time and say the team will confirm.",
      },
    };
  }
  // Kept on the call so the call shows the visit and counts as booked.
  await db
    .from("calls")
    .update({ appointment: { appointment_id: r.id, date: r.window.date, start: r.window.start, end: r.window.end, label: r.window.label, address, notes, at: new Date().toISOString() }, updated_at: new Date().toISOString() })
    .eq("id", who.callId);
  return {
    status: 200,
    body: { ok: true, booked: r.window.label, instruction: "The visit is booked. Repeat the day, window and address, and say they will get a reminder before the visit." },
  };
}

export async function runTool(req: ToolRequest): Promise<ToolResult> {
  const db = createAdminClient();
  const workspaceId = await findWorkspace(db, req.call);
  if (!workspaceId) return { status: 200, body: { ok: false, instruction: "Tell them the team will call back to schedule." } };
  if (req.name === "check_availability") return checkAvailability(db, workspaceId);
  if (req.name === "book_appointment") return bookAppointment(db, workspaceId, req.call, req.args ?? {});
  return { status: 404, body: { error: "unknown tool" } };
}
