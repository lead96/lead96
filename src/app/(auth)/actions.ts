"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

/** `fields` echoes back what the user typed, because React resets the form after an action. */
export type FormState = { error?: string; message?: string; fields?: Record<string, string> } | undefined;

function text(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Only allow same-site relative redirects. */
function safeNext(value: FormDataEntryValue | null, fallback = "/dashboard") {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

const signupSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name").max(120),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  intent: z.string().trim().max(500).optional(),
});

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    intent: formData.get("intent") || undefined,
  });
  const fields = { fullName: text(formData, "fullName"), email: text(formData, "email") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const next = safeNext(formData.get("next"), "/onboarding");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, lead_intent: parsed.data.intent ?? null },
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message, fields };

  // Email confirmation disabled in the project -> user is signed in already.
  if (data.session) redirect(next);
  return { message: "Check your email to confirm your account, then sign in." };
}

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const fields = { email: text(formData, "email") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password.", fields };

  redirect(safeNext(formData.get("next")));
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email", fields: { email: text(formData, "email") } };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });
  if (error?.status === 429) {
    return { error: "Too many reset emails were requested. Please wait a few minutes and try again.", fields: { email: parsed.data } };
  }
  if (error) console.error("resetPasswordForEmail failed:", error.message);
  // Same message whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.string().min(8, "Password must be at least 8 characters").safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error?.name === "AuthSessionMissingError" || error?.status === 401) redirect("/forgot-password?expired=1");
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
