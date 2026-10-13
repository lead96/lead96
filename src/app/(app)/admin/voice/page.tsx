import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Badge, Card, PageHeader, Section } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { listNumbers, retellConfigured, RetellError, type RetellNumber } from "@/lib/voice/retell";
import { AssignNumberForm, BuyNumberForm } from "./forms";

export const metadata: Metadata = { title: "AI voice" };

const pretty = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

export default async function VoiceAdminPage() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");

  const db = createAdminClient();
  const [{ data: businesses }, { data: assigned }] = await Promise.all([
    db.from("workspaces").select("id, name").order("name"),
    db.from("phone_numbers").select("e164, workspace_id"),
  ]);
  const assignedTo = new Map((assigned ?? []).map((a) => [a.e164, a.workspace_id as string | null]));
  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  const configured = retellConfigured();
  let numbers: RetellNumber[] = [];
  let numbersError: string | null = null;
  if (configured) {
    try {
      numbers = await listNumbers();
    } catch (e) {
      numbersError = e instanceof RetellError ? e.message : "Could not reach Retell.";
    }
  }

  return (
    <>
      <PageHeader
        title="AI voice"
        description="Lead96's Retell account: phone numbers and the AI caller of each business."
        back={{ href: "/admin", label: "Admin" }}
      />
      <div className="space-y-10">
        {!configured ? <Alert tone="error">RETELL_API_KEY is not set on the server.</Alert> : null}

        <Section title="Phone numbers" description="Numbers in the Lead96 Retell account. Inbound calls to a number go to the business it is assigned to.">
          {numbersError ? <Alert tone="error">{numbersError}</Alert> : null}
          {configured && !numbersError && numbers.length === 0 ? (
            <Card className="p-6 text-sm text-slate-600">No numbers yet. Buy one below.</Card>
          ) : null}
          <div className="space-y-4">
            {numbers.map((n) => {
              const ws = assignedTo.get(n.phone_number) ?? null;
              const agent = n.inbound_agents?.[0]?.agent_id;
              return (
                <Card key={n.phone_number} className="flex flex-wrap items-start justify-between gap-4 p-6" data-number={n.phone_number}>
                  <div className="min-w-0">
                    <p className="font-semibold tabular-nums text-slate-900">{n.phone_number_pretty ?? pretty(n.phone_number)}</p>
                    <p className="text-sm text-slate-500">
                      {n.phone_number}
                      {n.nickname ? ` · ${n.nickname}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ws ? <Badge tone="blue">{businessName.get(ws) ?? "Business"}</Badge> : <Badge>Not assigned</Badge>}
                      {agent ? <Badge tone="green">AI caller connected</Badge> : <Badge>No AI caller yet</Badge>}
                    </div>
                  </div>
                  <AssignNumberForm e164={n.phone_number} businesses={businesses ?? []} current={ws} />
                </Card>
              );
            })}
          </div>
        </Section>

        {configured ? (
          <Section title="Buy a number" description="A US number in the Lead96 Retell account, billed monthly to the card on that account.">
            <Card className="p-6">
              <BuyNumberForm businesses={businesses ?? []} />
            </Card>
          </Section>
        ) : null}
      </div>
    </>
  );
}
