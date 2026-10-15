"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireWorkspace } from "@/lib/auth";
import { bookWindow, rescheduleTo, type BookResult } from "@/lib/calendar/service";
import { createClient } from "@/lib/supabase/server";

export type CalendarState = { error?: string; message?: string } | undefined;

const WINDOW = /^(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})$/;

function refusal(r: Extract<BookResult, { ok: false }>) {
  if (r.reason === "blocked") return "That day is blocked.";
  if (r.reason === "error") return "Could not save. Please try again.";
  return "That window is no longer open. Pick another one.";
}

/** Confirm, done, no-show or cancel (any team member). */
export async function setAppointmentStatus(_: CalendarState, formData: FormData): Promise<CalendarState> {
  await requireWorkspace();
  const status = String(formData.get("status") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_appointment_status", {
    p_id: String(formData.get("appointment_id") ?? ""),
    p_status: status,
    p_reason: String(formData.get("reason") ?? "").trim().slice(0, 300) || null,
  });
  if (error) return { error: "Could not save. Please try again." };
  revalidatePath("/calendar");
  return { message: { confirmed: "Confirmed.", completed: "Marked as done.", no_show: "Marked as no-show.", cancelled: "Cancelled.", scheduled: "Saved." }[status] ?? "Saved." };
}

/** Move a visit to another open window. */
export async function moveAppointment(_: CalendarState, formData: FormData): Promise<CalendarState> {
  const workspace = await requireWorkspace();
  const m = WINDOW.exec(String(formData.get("window") ?? ""));
  if (!m) return { error: "Pick a new window." };
  const supabase = await createClient();
  const r = await rescheduleTo(supabase, { workspaceId: workspace.id, appointmentId: String(formData.get("appointment_id") ?? ""), date: m[1], start: m[2], end: m[3] });
  if (!r.ok) return { error: refusal(r) };
  revalidatePath("/calendar");
  return { message: `Moved to ${r.window.label}.` };
}

/** The team books a visit for a customer (from the customer page). */
export async function bookVisit(_: CalendarState, formData: FormData): Promise<CalendarState> {
  const workspace = await requireWorkspace();
  const m = WINDOW.exec(String(formData.get("window") ?? ""));
  if (!m) return { error: "Pick a window." };
  const customerId = String(formData.get("customer_id") ?? "");
  const supabase = await createClient();
  const r = await bookWindow(supabase, {
    workspaceId: workspace.id,
    date: m[1],
    start: m[2],
    end: m[3],
    customerId,
    source: "manual",
    address: String(formData.get("address") ?? "").trim().slice(0, 300) || null,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 1000) || null,
  });
  if (!r.ok) return { error: refusal(r) };
  revalidatePath(`/leads/${customerId}`);
  revalidatePath("/calendar");
  return { message: `Booked: ${r.window.label}.` };
}

const blackoutSchema = z
  .object({ starts_on: z.iso.date("Pick a start date"), ends_on: z.iso.date("Pick an end date"), reason: z.string().trim().max(120) })
  .refine((b) => b.ends_on >= b.starts_on, { message: "The end date is before the start date." });

/** Owners block days (holidays, vacation). Existing visits on those days stay; new ones are not offered. */
export async function addBlackout(_: CalendarState, formData: FormData): Promise<CalendarState> {
  const workspace = await requireOwner();
  const parsed = blackoutSchema.safeParse({
    starts_on: formData.get("starts_on"),
    ends_on: formData.get("ends_on") || formData.get("starts_on"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_blackouts").insert({ workspace_id: workspace.id, ...parsed.data, reason: parsed.data.reason || null });
  if (error) return { error: "Could not save. Please try again." };
  revalidatePath("/calendar");
  return { message: "Days blocked." };
}

export async function removeBlackout(formData: FormData) {
  const workspace = await requireOwner();
  const supabase = await createClient();
  await supabase.from("calendar_blackouts").delete().eq("id", String(formData.get("id") ?? "")).eq("workspace_id", workspace.id);
  revalidatePath("/calendar");
}
