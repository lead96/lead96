import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type DeliveryStatus = "processed" | "duplicate" | "rejected" | "failed" | "test";

/** Records one webhook delivery (shown in Admin → integration health). Never throws. */
export async function logDelivery(d: {
  provider: "call" | "meta" | "google";
  status: DeliveryStatus;
  error?: string;
  leadId?: string;
  workspaceId: string | null;
  externalId: string | null;
  payload: unknown;
}) {
  const admin = createAdminClient();
  let attempt = 1;
  if (d.externalId) {
    const { count } = await admin
      .from("webhook_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("provider", d.provider)
      .eq("external_id", d.externalId);
    attempt = (count ?? 0) + 1;
  }
  const { error } = await admin.from("webhook_deliveries").insert({
    provider: d.provider,
    external_id: d.externalId,
    workspace_id: d.workspaceId,
    status: d.status,
    error: d.error?.slice(0, 1000) ?? null,
    lead_id: d.leadId ?? null,
    attempt,
    payload: d.payload,
  });
  if (error) console.error("webhook_deliveries insert failed:", error.message);
}
