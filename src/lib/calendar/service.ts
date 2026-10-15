import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingHours } from "@/lib/setup/draft";
import { openWindows, type OpenWindow } from "./slots";

/** The server (service role) or a signed-in user; with a user, the database checks they are a member. */
type Db = SupabaseClient;

/** What the availability engine needs about one business: hours, zone, capacity, bookings, blocked days. */
export async function calendarContext(db: Db, workspaceId: string, opts: { ignoreAppointment?: string } = {}) {
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 40 * 86_400_000).toISOString();
  const [{ data: ws }, { data: profile }, { data: booked }, { data: blackouts }] = await Promise.all([
    db.from("workspaces").select("timezone").eq("id", workspaceId).single(),
    db.from("demand_profiles").select("booking_hours, capacity_per_day").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("appointments").select("id, starts_at, ends_at, status").eq("workspace_id", workspaceId).neq("status", "cancelled").gte("ends_at", from).lte("starts_at", to),
    db.from("calendar_blackouts").select("starts_on, ends_on").eq("workspace_id", workspaceId).gte("ends_on", from.slice(0, 10)),
  ]);
  return {
    timezone: ws?.timezone ?? "America/New_York",
    hours: (profile?.booking_hours ?? {}) as BookingHours,
    capacityPerDay: profile?.capacity_per_day ?? null,
    // When moving a visit, its own place does not count against the new window.
    booked: (booked ?? []).filter((b) => b.id !== opts.ignoreAppointment),
    blackouts: blackouts ?? [],
  };
}

export async function openWindowsFor(db: Db, workspaceId: string, days = 5, opts: { ignoreAppointment?: string } = {}): Promise<OpenWindow[]> {
  const c = await calendarContext(db, workspaceId, opts);
  return openWindows({ ...c, now: new Date(), days });
}

export type BookResult = { ok: true; id: string; window: OpenWindow } | { ok: false; reason: "not_open" | "full" | "day_full" | "blocked" | "error"; message?: string };

/**
 * Books one open window. The window must be one the engine offers right now; the database then
 * re-checks capacity under a lock (two callers cannot take the last place).
 */
export async function bookWindow(
  db: Db,
  p: { workspaceId: string; date: string; start: string; end: string; customerId?: string | null; leadId?: string | null; callId?: string | null; source: "ai_call" | "ai_text" | "manual"; service?: string | null; address?: string | null; notes?: string | null },
): Promise<BookResult> {
  const c = await calendarContext(db, p.workspaceId);
  const window = openWindows({ ...c, now: new Date(), days: 14 }).find((w) => w.date === p.date && w.start === p.start && w.end === p.end);
  if (!window) return { ok: false, reason: "not_open" };
  const { data, error } = await db.rpc("book_window", {
    p_workspace: p.workspaceId,
    p_starts: window.startsAt,
    p_ends: window.endsAt,
    p_window_cap: window.windowCap,
    p_day_cap: window.dayCap,
    p_tz: c.timezone,
    p_customer: p.customerId ?? null,
    p_lead: p.leadId ?? null,
    p_call: p.callId ?? null,
    p_source: p.source,
    p_service: p.service ?? null,
    p_address: p.address ?? null,
    p_notes: p.notes ?? null,
  });
  if (error) {
    const reason = (["full", "day_full", "blocked"] as const).find((r) => error.message === r);
    return reason ? { ok: false, reason } : { ok: false, reason: "error", message: error.message };
  }
  return { ok: true, id: data as string, window };
}

/** Moves a visit to another open window (capacity re-checked in the database, not counting itself). */
export async function rescheduleTo(db: Db, p: { workspaceId: string; appointmentId: string; date: string; start: string; end: string }): Promise<BookResult> {
  const c = await calendarContext(db, p.workspaceId, { ignoreAppointment: p.appointmentId });
  const window = openWindows({ ...c, now: new Date(), days: 14 }).find((w) => w.date === p.date && w.start === p.start && w.end === p.end);
  if (!window) return { ok: false, reason: "not_open" };
  const { error } = await db.rpc("reschedule_appointment", {
    p_id: p.appointmentId,
    p_starts: window.startsAt,
    p_ends: window.endsAt,
    p_window_cap: window.windowCap,
    p_day_cap: window.dayCap,
    p_tz: c.timezone,
  });
  if (error) {
    const reason = (["full", "day_full", "blocked"] as const).find((r) => error.message === r);
    return reason ? { ok: false, reason } : { ok: false, reason: "error", message: error.message };
  }
  return { ok: true, id: p.appointmentId, window };
}
