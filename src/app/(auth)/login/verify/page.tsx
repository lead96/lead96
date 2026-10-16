import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Field, Input } from "@/components/ui";
import { needsSecondFactor } from "@/lib/supabase/mfa";
import { createClient } from "@/lib/supabase/server";
import { logout, verifyTwoFactor } from "../../actions";
import { AuthForm } from "../../auth-form";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const state = await needsSecondFactor(supabase);
  if (!state.signedIn) redirect("/login");
  if (!state.needed) redirect(nextPath);

  return (
    <AuthForm
      title="Enter your code"
      action={verifyTwoFactor}
      submitLabel="Verify"
      footer={
        <form action={logout}>
          <button className="text-slate-600 hover:underline">Sign in with another account</button>
        </form>
      }
    >
      <p className="text-sm text-slate-600">Open your authenticator app and enter the 6-digit code for Lead96.</p>
      <input type="hidden" name="next" value={nextPath} />
      <Field label="Code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} autoFocus required />
      </Field>
    </AuthForm>
  );
}
