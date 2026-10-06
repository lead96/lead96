import Link from "next/link";
import type { Metadata } from "next";
import { Field, Input } from "@/components/ui";
import { signup } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, q, email } = await searchParams;
  const intent = typeof q === "string" ? q.slice(0, 500) : "";
  const nextPath = typeof next === "string" ? next : "";
  const prefill = typeof email === "string" ? email : "";
  const carry = new URLSearchParams({ ...(nextPath && { next: nextPath }), ...(prefill && { email: prefill }) }).toString();

  return (
    <AuthForm
      title="Create your account"
      action={signup}
      submitLabel="Create account"
      footer={
        <>
          Already have an account?{" "}
          <Link href={carry ? `/login?${carry}` : "/login"} className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <input type="hidden" name="next" value={nextPath} />
      {intent ? (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          You asked for: <span className="font-medium text-slate-900">“{intent}”</span>
          <input type="hidden" name="intent" value={intent} />
        </div>
      ) : null}
      <Field label="Your name" htmlFor="fullName">
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </Field>
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={prefill} required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
    </AuthForm>
  );
}
