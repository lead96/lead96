"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, buttonClass } from "@/components/ui";
import { confirmEmailLink } from "./actions";

export function ConfirmForm({
  tokenHash,
  code,
  type,
  next,
  label,
}: {
  tokenHash: string;
  code: string;
  type: string;
  next: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(confirmEmailLink, undefined);

  if (state?.error) {
    const isReset = type === "recovery";
    return (
      <div className="space-y-4">
        <Alert tone="error">
          {state.error === "invalid"
            ? "This link is incomplete. Please open it again from the email."
            : "This link has already been used or has expired. Each link works once."}
        </Alert>
        <Link href={isReset ? "/forgot-password" : "/login"} className={buttonClass("primary", "w-full")}>
          {isReset ? "Send a new reset link" : "Go to sign in"}
        </Link>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Checking..." : label}
      </Button>
    </form>
  );
}
