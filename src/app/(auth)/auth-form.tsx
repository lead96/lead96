"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { useRestoreFields } from "@/components/use-restore-fields";
import type { FormState } from "./actions";

/** Card + form wired to a server action, with error/success messages and pending state. */
export function AuthForm({
  title,
  action,
  submitLabel,
  children,
  footer,
}: {
  title: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useRestoreFields(formRef, state?.fields);

  return (
    <Card className="p-6">
      <h1 className="mb-5 text-lg font-semibold text-slate-900">{title}</h1>
      {state?.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : (
        <form ref={formRef} action={formAction} className="space-y-4">
          {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
          {children}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Please wait…" : submitLabel}
          </Button>
        </form>
      )}
      {footer ? <div className="mt-5 text-center text-sm text-slate-600">{footer}</div> : null}
    </Card>
  );
}
