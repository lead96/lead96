import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import { ManualLeadForm } from "./manual-lead-form";

export const metadata: Metadata = { title: "Add lead" };

export default async function NewLeadPage() {
  const workspace = await requireWorkspace();
  const ctx = await loadSetupContext(await createClient(), workspace);

  return (
    <>
      <PageHeader
        title="Add lead"
        description="For leads that come in another way — a walk-in, a referral, a call to your own number."
        back={{ href: "/leads", label: "Leads" }}
      />
      <Card className="max-w-xl p-6">
        <ManualLeadForm services={ctx.services} />
      </Card>
    </>
  );
}
