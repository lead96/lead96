import "server-only";
import type { AgentQuestion, BookingHours } from "@/lib/setup/draft";
import { dbError } from "@/lib/supabase/errors";
import { createAdminClient } from "@/lib/supabase/server";
import type { AgentInput } from "./agent-config";

/** Everything the AI caller needs to know about one business, read from its saved setup. */
export async function loadAgentInput(workspaceId: string): Promise<AgentInput> {
  const db = createAdminClient();
  const [ws, profile, agent, conv] = await Promise.all([
    db.from("workspaces").select("name, vertical, timezone").eq("id", workspaceId).single(),
    db
      .from("demand_profiles")
      .select("services, customer_types, zip_codes, excluded_zip_codes, booking_hours, appointment_minutes")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db.from("agent_settings").select("questions, transfer_phone, escalation_rules, greeting").eq("workspace_id", workspaceId).maybeSingle(),
    db
      .from("setup_conversations")
      .select("extracted")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (ws.error) throw dbError("Could not load the business", ws.error);
  for (const r of [profile, agent, conv]) if (r.error) throw dbError("Could not load the business setup", r.error);

  const taxonomy = await db.from("taxonomy_values").select("category, value, label").eq("vertical", ws.data.vertical).eq("active", true).order("sort");
  if (taxonomy.error) throw dbError("Could not load services", taxonomy.error);
  const label = (category: string, value: string) =>
    taxonomy.data.find((t) => t.category === category && t.value === value)?.label ?? value;

  const p = profile.data;
  const excluded = new Set<string>(p?.excluded_zip_codes ?? []);
  const extracted = (conv.data?.extracted ?? {}) as { area_description?: unknown };
  return {
    businessName: ws.data.name,
    timezone: ws.data.timezone,
    services: (p?.services ?? []).map((v: string) => ({ value: v, label: label("service", v) })),
    customerTypes: (p?.customer_types ?? []).map((v: string) => label("customer_type", v)),
    zipCodes: (p?.zip_codes ?? []).filter((z: string) => !excluded.has(z)),
    areaDescription: typeof extracted.area_description === "string" ? extracted.area_description : null,
    bookingHours: (p?.booking_hours ?? {}) as BookingHours,
    appointmentMinutes: p?.appointment_minutes ?? 60,
    questions: ((agent.data?.questions ?? []) as AgentQuestion[]).filter((q) => q?.question),
    transferPhone: agent.data?.transfer_phone ?? null,
    escalation: (agent.data?.escalation_rules ?? {}) as AgentInput["escalation"],
    greeting: agent.data?.greeting ?? null,
  };
}
