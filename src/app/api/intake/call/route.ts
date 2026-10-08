import { after } from "next/server";
import { serverEnv } from "@/lib/env";
import { callPayloadSchema, callToLead } from "@/lib/intake/call";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "@/lib/intake/signature";
import { logDelivery } from "@/lib/intake/deliveries";
import { ingestLead } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/server";

const MAX_BODY = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Call intake webhook (see src/lib/intake/call.ts for the payload). Signed with
 * INTAKE_SIGNING_SECRET. Idempotent by call_id: a retried delivery returns the original lead.
 * 2xx = stored (or already stored) · 4xx = don't retry · 5xx = retry later.
 */
export async function POST(request: Request) {
  const secret = serverEnv().INTAKE_SIGNING_SECRET;
  if (!secret) return Response.json({ error: "intake_disabled" }, { status: 503 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });

  const check = verify({
    secret,
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  // Unsigned requests are not logged: anyone on the internet can send them.
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = json as Record<string, unknown>;
  const workspaceId = typeof raw?.workspace_id === "string" && UUID.test(raw.workspace_id) ? raw.workspace_id : null;
  const callId = typeof raw?.call_id === "string" ? raw.call_id.slice(0, 200) : null;
  const log = (d: { status: "processed" | "duplicate" | "rejected" | "failed"; error?: string; leadId?: string; workspaceId?: string | null }) =>
    after(() => logDelivery({ ...d, provider: "call", externalId: callId, workspaceId: d.workspaceId === undefined ? workspaceId : d.workspaceId, payload: json }));

  const parsed = callPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    log({ status: "rejected", error: issues.join("; "), workspaceId: await existingWorkspace(workspaceId) });
    return Response.json({ error: "invalid_payload", issues }, { status: 422 });
  }

  if (!(await existingWorkspace(parsed.data.workspace_id))) {
    log({ status: "rejected", error: "unknown workspace", workspaceId: null });
    return Response.json({ error: "unknown_workspace" }, { status: 422 });
  }

  const result = await ingestLead(callToLead(parsed.data));
  if (!result.ok) {
    // Normalization errors (no usable caller number) are permanent; database errors are not.
    const permanent = result.error.includes("phone number or email");
    log({ status: permanent ? "rejected" : "failed", error: permanent ? "no caller number or email" : result.error });
    return permanent
      ? Response.json({ error: "no_contact", message: "The call has no caller number or email, so no lead was created." }, { status: 422 })
      : Response.json({ error: "temporary_failure" }, { status: 500 });
  }

  log({ status: result.duplicate ? "duplicate" : "processed", leadId: result.leadId });
  return Response.json({ ok: true, lead_id: result.leadId, customer_id: result.customerId, duplicate: result.duplicate });
}

async function existingWorkspace(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await createAdminClient().from("workspaces").select("id").eq("id", id).maybeSingle();
  return data?.id ?? null;
}
