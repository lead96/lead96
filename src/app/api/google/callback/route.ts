import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE as STATE_COOKIE, completeSignIn, GoogleAdsError } from "@/lib/google/ads";

/** Google sends the admin back here after the consent screen. */
export async function GET(request: NextRequest) {
  const back = new URL("/admin/google", request.url);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return res;
  };

  const profile = await getProfile();
  if (!profile?.is_platform_admin) return NextResponse.redirect(new URL("/dashboard", request.url));

  const q = request.nextUrl.searchParams;
  if (q.get("error")) return done({ error: q.get("error") === "access_denied" ? "Sign-in was cancelled." : `Google said: ${q.get("error")}` });
  const state = q.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const same = state.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!same) return done({ error: "The sign-in link expired or was opened in another browser. Try Connect again." });
  const code = q.get("code");
  if (!code) return done({ error: "Google did not return a sign-in code." });

  try {
    const email = await completeSignIn(code, profile.id);
    return done({ connected: email ?? "1" });
  } catch (e) {
    return done({ error: e instanceof GoogleAdsError ? e.message : "Could not finish the Google sign-in." });
  }
}
