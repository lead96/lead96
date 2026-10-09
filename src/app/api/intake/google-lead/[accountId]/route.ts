import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { adGroupNames, getConnection } from "@/lib/google/ads";
import { googleWebhookSchema, webhookToLead } from "@/lib/google/leads";
import { logDelivery } from "@/lib/intake/deliveries";
import { ingestLead } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/server";

const MAX_BODY = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Google Ads lead-form webhook. Each ad account has its own URL (this path) and key, entered in the
 * lead form in Google Ads. Google retries on 5xx and may deliver a lead twice; the lead id
 * (or click id) keeps it to one lead. Test leads from the form editor are logged, not stored.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/intake/google-lead/[accountId]">) {
  const { accountId } = await ctx.params;
  if (!UUID.test(accountId)) return Response.json({ error: "unknown_account" }, { status: 404 });

  const body = await request.text();
  if (body.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });

  const admin = createAdminClient();
  const { data: account } = await admin.from("ad_accounts").select("id, workspace_id, external_id, webhook_key").eq("id", accountId).eq("platform", "google").maybeSingle();
  if (!account) return Response.json({ error: "unknown_account" }, { status: 404 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = googleWebhookSchema.safeParse(json);
  const leadId = typeof (json as { lead_id?: unknown })?.lead_id === "string" ? ((json as { lead_id: string }).lead_id).slice(0, 200) : null;
  const log = (d: { status: "processed" | "duplicate" | "rejected" | "failed" | "test"; error?: string; leadId?: string; payload?: unknown }) =>
    after(() => logDelivery({ provider: "google", workspaceId: account.workspace_id, externalId: leadId, payload: d.payload === undefined ? json : d.payload, ...d }));

  const key = typeof (json as { google_key?: unknown })?.google_key === "string" ? (json as { google_key: string }).google_key : "";
  if (!safeEqual(key, account.webhook_key)) {
    // Logged without the body: it didn't come with our key.
    log({ status: "rejected", error: "wrong google_key - check the key in the lead form's webhook settings", payload: null });
    return Response.json({ error: "invalid_key" }, { status: 401 });
  }
  if (!parsed.success) {
    log({ status: "rejected", error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  const lead = parsed.data;
  if (lead.is_test) {
    log({ status: "test" });
    return Response.json({});
  }

  const result = await ingestLead(webhookToLead(lead, account.workspace_id));
  if (!result.ok) {
    const permanent = result.error.includes("phone number or email");
    log({ status: permanent ? "rejected" : "failed", error: permanent ? "no phone number or email in the form" : result.error });
    return permanent ? Response.json({ error: "no_contact" }, { status: 400 }) : Response.json({ error: "temporary_failure" }, { status: 500 });
  }
  log({ status: result.duplicate ? "duplicate" : "processed", leadId: result.leadId });

  // The webhook carries only IDs; look up the campaign and ad group names afterwards.
  if (!result.duplicate && lead.adgroup_id) {
    after(async () => {
      try {
        if (!(await getConnection())) return;
        const names = await adGroupNames(account.external_id, lead.adgroup_id!);
        await admin.from("leads").update({ campaign_name: names.campaign, adset_name: names.adGroup }).eq("id", result.leadId);
      } catch (e) {
        console.error("google lead name lookup failed:", e instanceof Error ? e.message : e);
      }
    });
  }
  return Response.json({});
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
