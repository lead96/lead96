import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeLead, type RawLead } from "./normalize";

export type IngestResult =
  | { ok: true; leadId: string; customerId: string; customerCreated: boolean; duplicate: boolean }
  | { ok: false; error: string };

/**
 * The single entry point for new leads and calls from every source. Runs with the service
 * role — callers must already have checked who is allowed to add leads to this workspace
 * (a signed-in member, a published landing page, a verified webhook…).
 */
export async function ingestLead(raw: RawLead): Promise<IngestResult> {
  const normalized = normalizeLead(raw);
  if (!normalized.ok) return normalized;

  const { data, error } = await createAdminClient().rpc("ingest_lead", { p: normalized.lead });
  if (error) {
    console.error("ingest_lead failed:", error.message);
    return { ok: false, error: "Could not save the lead. Please try again." };
  }
  const r = data as { lead_id: string; customer_id: string; customer_created: boolean; duplicate: boolean };
  return { ok: true, leadId: r.lead_id, customerId: r.customer_id, customerCreated: r.customer_created, duplicate: r.duplicate };
}
