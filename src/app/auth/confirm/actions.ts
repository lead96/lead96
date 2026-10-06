"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "signup", "recovery", "invite", "magiclink", "email_change"];

export type ConfirmState = { error?: "used_or_expired" | "invalid" } | undefined;

/** Relative, same-site paths only. Recovery links always end on the new-password screen. */
function destination(type: string, next: string) {
  if (type === "recovery") return "/reset-password";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/**
 * Uses up the one-time token from an auth email. Runs on the button press, not on
 * page load, so mail scanners and link previews that open the URL don't burn it.
 */
export async function confirmEmailLink(_: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const code = String(formData.get("code") ?? "");
  const type = String(formData.get("type") ?? "");
  const next = String(formData.get("next") ?? "");

  const supabase = await createClient();
  let error: { message: string } | null;
  if (tokenHash && OTP_TYPES.includes(type as EmailOtpType)) {
    ({ error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash }));
  } else if (code) {
    // Older PKCE-style links (Supabase default template). Only work in the browser that asked for them.
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return { error: "invalid" };
  }

  if (error) {
    console.warn("auth link rejected:", type || "code", error.message);
    return { error: "used_or_expired" };
  }
  redirect(destination(type, next));
}
