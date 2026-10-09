import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE as STATE_COOKIE, completeSignIn, GoogleAdsError } from "@/lib/google/ads";
import { createAdminClient } from "@/lib/supabase/server";

/** Google sends the admin back here after the consent screen. Every outcome is written to the audit log. */
export async function GET(request: NextRequest) {
  const back = new URL("/admin/google", request.url);
  const profile = await getProfile();
  const done = async (params: Record<string, string>, reason: string) => {
    const ok = "connected" in params;
    await createAdminClient()
      .from("audit_log")
      .insert({
        actor_id: profile?.id ?? null,
        action: ok ? "google_ads.connected" : "google_ads.connect_failed",
        target: "google_ads",
        metadata: { reason, host: request.nextUrl.host },
      });
    if (!ok) console.error("Google Ads connect failed:", reason);
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return res;
  };

  if (!profile?.is_platform_admin) return done({ error: "Platform admins only." }, profile ? "not a platform admin" : "not signed in");

  const q = request.nextUrl.searchParams;
  const googleError = q.get("error");
  if (googleError) {
    return done({ error: googleError === "access_denied" ? "Sign-in was cancelled." : `Google said: ${googleError}` }, `google error: ${googleError}`);
  }
  const state = q.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const same = state.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!same) {
    return done(
      { error: "The sign-in link expired or was opened in another browser. Try Connect again." },
      expected ? "state mismatch" : "no state cookie (opened in another browser, or host differs from where Connect was clicked)",
    );
  }
  const code = q.get("code");
  if (!code) return done({ error: "Google did not return a sign-in code." }, "no code");

  try {
    const email = await completeSignIn(code, profile.id);
    return done({ connected: email ?? "1" }, `connected as ${email ?? "unknown"}`);
  } catch (e) {
    const message = e instanceof GoogleAdsError ? e.message : "Could not finish the Google sign-in.";
    return done({ error: message }, e instanceof GoogleAdsError ? `${e.code}: ${e.message}` : String(e));
  }
}
