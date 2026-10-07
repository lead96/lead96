import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { Alert, Card } from "@/components/ui";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Continue" };

const COPY: Record<string, { title: string; text: string; label: string }> = {
  recovery: { title: "Reset your password", text: "Continue to choose a new password.", label: "Continue" },
  email_change: { title: "Confirm your new email", text: "Continue to confirm your new email address.", label: "Confirm email" },
  magiclink: { title: "Sign in", text: "Continue to sign in to Lead96.", label: "Sign in" },
};
const DEFAULT_COPY = { title: "Confirm your email", text: "Continue to confirm your email address.", label: "Confirm email" };

/** Landing page for links in auth emails. The token is only used when the user presses the button. */
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tokenHash = get("token_hash");
  const code = get("code");
  const type = get("type");
  const copy = COPY[type] ?? DEFAULT_COPY;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo height={30} />
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-slate-900">{copy.title}</h1>
        {tokenHash || code ? (
          <>
            <p className="mb-5 mt-1 text-sm text-slate-500">{copy.text}</p>
            <ConfirmForm tokenHash={tokenHash} code={code} type={type} next={get("next")} label={copy.label} />
          </>
        ) : (
          <div className="mt-4">
            <Alert tone="error">This link is incomplete. Please open it again from the email.</Alert>
          </div>
        )}
      </Card>
    </div>
  );
}
