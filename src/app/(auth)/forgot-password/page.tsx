import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Field, Input } from "@/components/ui";
import { requestPasswordReset } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { expired } = await searchParams;
  return (
    <div className="space-y-4">
      {expired ? (
        <Alert tone="error">Your reset link has expired or was already used. Request a new one below.</Alert>
      ) : null}
      <AuthForm
        title="Reset your password"
        action={requestPasswordReset}
        submitLabel="Send reset link"
        footer={
          <Link href="/login" className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
      </AuthForm>
    </div>
  );
}
