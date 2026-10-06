import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Field, Input } from "@/components/ui";
import { login } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, email } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";
  const prefill = typeof email === "string" ? email : "";
  const carry = new URLSearchParams({ ...(nextPath && { next: nextPath }), ...(prefill && { email: prefill }) }).toString();

  return (
    <div className="space-y-4">
      {error === "link_invalid" ? (
        <Alert tone="error">That link is invalid or has expired. Please try again.</Alert>
      ) : null}
      <AuthForm
        title="Sign in"
        action={login}
        submitLabel="Sign in"
        footer={
          <>
            No account?{" "}
            <Link
              href={carry ? `/signup?${carry}` : "/signup"}
              className="font-medium text-brand-600 hover:underline"
            >
              Create one
            </Link>
          </>
        }
      >
        <input type="hidden" name="next" value={nextPath} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={prefill} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="text-right text-sm">
          <Link href="/forgot-password" className="text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
      </AuthForm>
    </div>
  );
}
