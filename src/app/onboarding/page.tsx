import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/app/invite/actions";
import { Button, Card } from "@/components/ui";
import { getCurrentWorkspace, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your business" };

type PendingInvite = { token: string; workspace_name: string; role: string; expires_at: string };

export default async function OnboardingPage() {
  await requireUser();
  if (await getCurrentWorkspace()) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_pending_invites");
  const invites = data as PendingInvite[] | null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo height={30} />
      </div>
      <div className="w-full max-w-md space-y-6">
        {invites && invites.length > 0 ? (
          <Card className="p-6">
            <h2 className="font-semibold text-slate-900">You’ve been invited</h2>
            <ul className="mt-3 space-y-3">
              {invites.map((inv) => (
                <li key={inv.token} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    <span className="font-medium text-slate-900">{inv.workspace_name}</span> ·{" "}
                    <span className="capitalize">{inv.role}</span>
                  </span>
                  <form action={acceptInvite}>
                    <input type="hidden" name="token" value={inv.token} />
                    <Button type="submit">Join</Button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">Joining a team? You don’t need to create your own business below.</p>
          </Card>
        ) : null}
        <OnboardingForm />
      </div>
    </div>
  );
}
