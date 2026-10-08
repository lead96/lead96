import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { getConnection, syncAccount } from "@/lib/google/ads";
import { createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Daily Google Ads sync (vercel.json cron): catches up on leads the webhook missed and stores
 * the last 3 days of spend for every assigned account. Vercel sends CRON_SECRET as a Bearer token.
 */
export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await getConnection())) return Response.json({ skipped: "Google Ads not connected" });

  const { data: accounts } = await createAdminClient().from("ad_accounts").select("id, workspace_id, external_id, currency, last_sync_at").eq("platform", "google");
  const results: Record<string, unknown> = {};
  for (const account of accounts ?? []) {
    try {
      results[account.external_id] = await syncAccount(account, 3);
    } catch (e) {
      results[account.external_id] = { error: e instanceof Error ? e.message : "failed" };
    }
  }
  return Response.json({ accounts: results });
}
