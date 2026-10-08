import "server-only";
import { serverEnv } from "@/lib/env";
import { GoogleAdsError, getConnection, listClientAccounts } from "@/lib/google/ads";
import { createClient } from "@/lib/supabase/server";

export type LiveCheck = { key: string; label: string; ok: boolean | null; detail: string; ms: number | null };

const TIMEOUT_MS = 8000;

/**
 * Real calls to each external service, run on demand from Admin. None of them costs money or
 * changes anything: OpenAI lists models, Google is asked to redeem a fake code (a valid client
 * gets "invalid_grant", a wrong one "invalid_client"), Meta checks the token's scopes.
 */
export async function runLiveChecks(): Promise<LiveCheck[]> {
  const env = serverEnv();
  return Promise.all([
    timed("database", "Database", async () => {
      const { error } = await (await createClient()).from("workspaces").select("id", { head: true, count: "exact" });
      return error ? fail(`Query failed: ${error.message}`) : pass("Reachable.");
    }),

    timed("openai", "OpenAI", async () => {
      if (!env.OPENAI_API_KEY) return skip("API key not set.");
      const res = await get("https://api.openai.com/v1/models", { authorization: `Bearer ${env.OPENAI_API_KEY}` });
      if (res.ok) return pass("Key accepted.");
      if (res.status === 401) return fail("Key rejected (401). Replace OPENAI_API_KEY.");
      return fail(`Unexpected response ${res.status}.`);
    }),

    timed("google", "Google OAuth client", async () => {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return skip("Client ID / secret not set.");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code: "lead96-health-check",
          grant_type: "authorization_code",
          redirect_uri: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/google/callback`,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_grant") return pass("Client ID and secret valid.");
      if (body.error === "invalid_client" || body.error === "unauthorized_client") return fail("Client ID or secret is wrong.");
      return fail(`Unexpected answer: ${body.error ?? res.status}.`);
    }),

    timed("google_ads", "Google Ads API", async () => {
      const connection = await getConnection();
      if (!connection) return skip("Not connected yet (Admin → Google Ads → Connect).");
      try {
        const accounts = await listClientAccounts();
        return pass(`Signed in as ${connection.account_email ?? "unknown"}; ${accounts.length} ad account${accounts.length === 1 ? "" : "s"} under the manager account.`);
      } catch (e) {
        return fail(e instanceof GoogleAdsError ? e.message : "Request failed.");
      }
    }),

    timed("meta", "Meta app + System User token", async () => {
      if (!env.META_APP_ID || !env.META_APP_SECRET) return skip("App ID / secret not set.");
      const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
      if (!env.META_SYSTEM_USER_TOKEN) {
        const res = await get(`https://graph.facebook.com/v21.0/${env.META_APP_ID}?fields=name&access_token=${encodeURIComponent(appToken)}`);
        return res.ok ? pass("App ID and secret valid. System User token not set.") : fail("App ID or secret is wrong.");
      }
      const res = await get(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(env.META_SYSTEM_USER_TOKEN)}&access_token=${encodeURIComponent(appToken)}`,
      );
      const body = (await res.json().catch(() => ({}))) as { data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] } };
      if (!res.ok || !body.data) return fail(`Could not check the token (${res.status}).`);
      if (!body.data.is_valid) return fail("System User token is invalid or revoked.");
      const needed = ["leads_retrieval", "pages_manage_metadata", "pages_read_engagement", "pages_show_list", "ads_read", "business_management"];
      const lacking = needed.filter((s) => !body.data!.scopes?.includes(s));
      if (lacking.length) return fail(`Token is missing permissions: ${lacking.join(", ")}.`);
      return pass(body.data.expires_at ? `Valid; expires ${new Date(body.data.expires_at * 1000).toISOString().slice(0, 10)}.` : "Valid, never expires.");
    }),

    timed("intake", "Call intake", async () =>
      env.INTAKE_SIGNING_SECRET ? pass("Signing secret set.") : skip("INTAKE_SIGNING_SECRET not set — endpoint answers 503."),
    ),
  ]);
}

type Result = Pick<LiveCheck, "ok" | "detail">;
const pass = (detail: string): Result => ({ ok: true, detail });
const fail = (detail: string): Result => ({ ok: false, detail });
const skip = (detail: string): Result => ({ ok: null, detail });

const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });

async function timed(key: string, label: string, fn: () => Promise<Result>): Promise<LiveCheck> {
  const start = Date.now();
  try {
    const r = await fn();
    return { key, label, ...r, ms: r.ok === null ? null : Date.now() - start };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return { key, label, ok: false, detail: timeout ? `No answer within ${TIMEOUT_MS / 1000} s.` : "Could not connect.", ms: Date.now() - start };
  }
}
