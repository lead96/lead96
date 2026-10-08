import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE as STATE_COOKIE, authUrl, googleConfig } from "@/lib/google/ads";

/** Starts the one-time Google sign-in for the Lead96 manager account. Platform admins only. */
export async function GET(request: NextRequest) {
  const back = new URL("/admin/google", request.url);
  const profile = await getProfile();
  if (!profile?.is_platform_admin) return NextResponse.redirect(new URL("/dashboard", request.url));
  const missing = googleConfig().missing;
  if (missing.length) {
    back.searchParams.set("error", `Missing settings: ${missing.join(", ")}`);
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
