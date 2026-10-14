import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { inboundCallVariables } from "@/lib/voice/agent-config";
import { RETELL_SIGNATURE_HEADER, verifyRetell } from "@/lib/voice/signature";

type Inbound = { call_id?: string; agent_id?: string; from_number?: string; to_number?: string };

/**
 * Retell asks this before connecting an incoming call to a business number (inbound_webhook_url).
 * Known callers are greeted by name; the call is tagged with the business. Answers within Retell's
 * 10 s timeout; on any failure Retell connects the number's own agent with the default greeting.
 */
export async function POST(request: NextRequest) {
  const key = serverEnv().RETELL_API_KEY;
  if (!key) return NextResponse.json({ error: "voice not configured" }, { status: 503 });
  const raw = await request.text();
  // It returns a caller's name, so it must come from Retell.
  if (!verifyRetell(raw, key, request.headers.get(RETELL_SIGNATURE_HEADER))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: { event?: string; call_inbound?: Inbound } & Inbound;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const c: Inbound = body.call_inbound ?? body;
  if (!c.to_number) return NextResponse.json({ call_inbound: {} });

  const db = createAdminClient();
  const { data: number } = await db.from("phone_numbers").select("workspace_id").eq("e164", c.to_number).maybeSingle();
  if (!number?.workspace_id) return NextResponse.json({ call_inbound: {} });
  const workspaceId = number.workspace_id;

  const [{ data: ws }, { data: agent }, { data: customer }] = await Promise.all([
    db.from("workspaces").select("name, vertical").eq("id", workspaceId).single(),
    db.from("voice_agents").select("retell_agent_id").eq("workspace_id", workspaceId).maybeSingle(),
    c.from_number
      ? db.from("customers").select("id, full_name, service, zip").eq("workspace_id", workspaceId).eq("phone", c.from_number).is("merged_into", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  let serviceLabel: string | null = null;
  if (customer?.service) {
    serviceLabel =
      (await db.from("taxonomy_values").select("label").eq("vertical", ws?.vertical ?? "hvac").eq("category", "service").eq("value", customer.service).maybeSingle()).data
        ?.label ?? customer.service;
  }

  return NextResponse.json({
    call_inbound: {
      ...(agent?.retell_agent_id ? { override_agent_id: agent.retell_agent_id } : {}),
      dynamic_variables: inboundCallVariables(ws?.name ?? "the business", customer ? { full_name: customer.full_name, serviceLabel, zip: customer.zip } : null),
      metadata: { workspace_id: workspaceId, trigger: "inbound", ...(customer ? { customer_id: customer.id } : {}) },
    },
  });
}
