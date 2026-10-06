import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Field, Input } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { resetPassword } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached through the email link, which signs the user in first.
  if (!(await getUser())) redirect("/forgot-password?expired=1");

  return (
    <AuthForm title="Choose a new password" action={resetPassword} submitLabel="Save password">
      <Field label="New password" htmlFor="password" hint="At least 8 characters">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
    </AuthForm>
  );
}
