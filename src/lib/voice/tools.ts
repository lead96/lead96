import "server-only";
import type { BookingHours } from "@/lib/setup/draft";
import { createAdminClient } from "@/lib/supabase/server";
import { availableWindows } from "./availability";
import { callMetadata, type RetellCall } from "./calls";
import { findWorkspace } from "./webhook";

/**
 * Tools the AI uses during a call (Retell custom functions). The answer is read by the AI, so it is
 * short, factual JSON. Until M4 there is no calendar: windows come from the visit hours and a booking
 * is a request the team confirms.
 */
export type ToolRequest = { name: string; call: RetellCall; args: Record<string, unknown> };
export type ToolResult = { status: number; body: Record<string, unknown> };

type Db = ReturnType<typeof createAdminClient>;

async function windowsFor(db: Db, workspaceId: string) {
  const [{ data: ws }, { data: profile }] = await Promise.all([
    db.from("workspaces").select("timezone").eq("id", workspaceId).single(),
    db.from("demand_profiles").select("booking_hours").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  return availableWindows((profile?.booking_hours ?? {}) as BookingHours, ws?.timezone ?? "America/New_York", new Date(), 5);
}

async function checkAvailability(db: Db, workspaceId: string): Promise<ToolResult> {
  const windows = await windowsFor(db, workspaceId);
  if (!windows.length) {
    return { status: 200, body: { windows: [], instruction: "No visit hours are set. Ask which day and time suits them and say the team will confirm." } };
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

async function bookAppointment(db: Db, workspaceId: string, call: RetellCall, args: Record<string, unknown>): Promise<ToolResult> {
  const date = str(args.date, 10);
  const start = str(args.start, 5);
  const end = str(args.end, 5);
  const windows = await windowsFor(db, workspaceId);
  const chosen = windows.find((w) => w.date === date && w.start === start && w.end === end);
  if (!chosen) {
    return {
      status: 200,
      body: { ok: false, instruction: "That window is not open. Call check_availability again and offer one of the windows it returns." },
    };
  }
  const appointment = {
    date: chosen.date,
    start: chosen.start,
    end: chosen.end,
    label: chosen.label,
    address: str(args.address, 200) || null,
    notes: str(args.notes, 500) || null,
    at: new Date().toISOString(),
  };

  // The call row exists for calls we placed; for an inbound call the call_started webhook made it.
  const meta = callMetadata(call);
  let { data: row } = await db.from("calls").select("id, customer_id").eq("provider_call_id", call.call_id).maybeSingle();
  if (!row && meta.call_row_id) row = (await db.from("calls").select("id, customer_id").eq("id", meta.call_row_id).eq("workspace_id", workspaceId).maybeSingle()).data;
  if (!row) {
    const inbound = call.direction === "inbound";
    row = (
      await db
        .from("calls")
        .upsert(
          { workspace_id: workspaceId, provider_call_id: call.call_id, direction: inbound ? "inbound" : "outbound", trigger: meta.trigger ?? (inbound ? "inbound" : "manual"), status: "ongoing", from_number: call.from_number ?? null, to_number: call.to_number ?? null },
          { onConflict: "provider_call_id" },
        )
        .select("id, customer_id")
        .single()
    ).data;
  }
  if (!row) return { status: 500, body: { ok: false } };
  await db.from("calls").update({ appointment, updated_at: new Date().toISOString() }).eq("id", row.id);

  // Known person: put the request on their timeline now (an inbound caller becomes a customer when the call ends).
  let customerId = row.customer_id ?? meta.customer_id ?? null;
  if (!customerId && call.direction === "inbound" && call.from_number) {
    customerId = (await db.from("customers").select("id").eq("workspace_id", workspaceId).eq("phone", call.from_number).is("merged_into", null).maybeSingle()).data?.id ?? null;
  }
  if (customerId) {
    await db.from("events").insert({
      workspace_id: workspaceId,
      type: "appointment.requested",
      subject_table: "calls",
      subject_id: row.id,
      customer_id: customerId,
      payload: { label: chosen.label, date: chosen.date, start: chosen.start, end: chosen.end, address: appointment.address, notes: appointment.notes },
    });
  }
  return {
    status: 200,
    body: { ok: true, booked: chosen.label, instruction: "Confirm the day, window and address back to them, and say the team will confirm the visit shortly by phone or text." },
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
