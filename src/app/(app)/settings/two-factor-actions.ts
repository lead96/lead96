"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type TwoFactorState = { error?: string; message?: string; factorId?: string; qr?: string; secret?: string } | undefined;

const CODE = /^\d{6}$/;
const code = (formData: FormData) => String(formData.get("code") ?? "").replace(/\s/g, "");

/** Step 1: a new authenticator factor (QR code + secret). Abandoned, unconfirmed ones are removed first. */
export async function startTwoFactor(): Promise<TwoFactorState> {
  await requireUser();
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  if (factors?.totp.length) return { error: "Two-factor is already on." };
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Lead96", friendlyName: `Authenticator ${Date.now()}` });
  if (error || !data) return { error: "Could not start two-factor setup. Please try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Step 2: the first code from the app confirms it; the session is upgraded at the same time. */
export async function confirmTwoFactor(state: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  await requireUser();
  const factorId = String(formData.get("factor_id") ?? "");
  if (!CODE.test(code(formData))) return { ...state, error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code(formData) });
  if (error) return { ...state, error: "That code didn't work. Check the time on your phone and try the newest code." };
  revalidatePath("/settings");
  return { message: "Two-factor sign-in is on. You'll be asked for a code each time you sign in." };
}

/** Turning it off needs a current code too, so an unlocked computer isn't enough. */
export async function removeTwoFactor(_: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  await requireUser();
  if (!CODE.test(code(formData))) return { error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) return { message: "Two-factor sign-in is off." };
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code(formData) });
  if (verified.error) return { error: "That code didn't work. Check the time on your phone and try the newest code." };
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return { error: "Could not turn it off. Please try again." };
  // The session keeps aal2 until it refreshes; the next refresh drops back to a password-only session.
  revalidatePath("/settings");
  return { message: "Two-factor sign-in is off." };
}
