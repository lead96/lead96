import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Card, PageHeader, buttonClass } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { draftFromSaved } from "@/lib/setup/draft";
import type { CampaignPlan } from "@/lib/setup/plan";
import { loadSaved, loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import { AgentSettingsForm, DemandProfileForm, RegeneratePlanButton } from "./forms";

export const metadata: Metadata = { title: "Business profile" };

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const { saved: savedParam, plan: planParam } = await searchParams;
  const supabase = await createClient();

  const [ctx, saved, { data: planRow }] = await Promise.all([
    loadSetupContext(supabase, workspace),
    loadSaved(supabase, workspace.id),
    supabase
      .from("campaign_plans")
      .select("summary, plan, created_at, model")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const values = draftFromSaved(saved.profile, null);
  const plan = planRow?.plan as CampaignPlan | undefined;

  return (
    <>
      <PageHeader
        title="Business profile"
        description="The jobs you want, where and when — used by the AI caller, booking and your campaign plan."
        actions={
          isOwner ? (
            <Link href="/setup" className={buttonClass("secondary")}>
              {workspace.setupCompletedAt ? "Update with assistant" : "Use setup assistant"}
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {savedParam === "setup" ? (
          <Alert tone={planParam === "failed" ? "info" : "success"}>
            {planParam === "failed"
              ? "Your setup is saved. We couldn't create the campaign plan just now — use “Create plan” below to try again."
              : "Your setup is saved and your campaign plan is ready below. You can change anything here at any time."}
          </Alert>
        ) : null}

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Jobs, area and hours</h2>
          <DemandProfileForm
            values={{ ...values, appointment_minutes: saved.profile?.appointment_minutes ?? null }}
            options={{ services: ctx.services, customerTypes: ctx.customerTypes }}
            readOnly={!isOwner}
          />
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">AI call settings</h2>
          <AgentSettingsForm
            questions={saved.agent?.questions ?? []}
            transferPhone={saved.agent?.transfer_phone ?? null}
            greeting={saved.agent?.greeting ?? null}
            readOnly={!isOwner}
          />
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Suggested campaign plan</h2>
              <p className="text-sm text-slate-500">
                A recommendation only — nothing is launched. Campaign launching comes in a later phase.
              </p>
            </div>
            {planRow ? (
              <span className="text-xs text-slate-400">Created {new Date(planRow.created_at).toLocaleString("en-US")}</span>
            ) : null}
          </div>

          {plan && planRow ? (
            <div className="space-y-5 text-sm text-slate-700">
              <p>{planRow.summary}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Channel</th>
                      <th className="py-2 pr-4 font-medium">Share</th>
                      <th className="py-2 pr-4 font-medium">Per month</th>
                      <th className="py-2 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.channels.map((c) => (
                      <tr key={c.channel}>
                        <td className="py-2 pr-4 font-medium text-slate-900">{c.label}</td>
                        <td className="py-2 pr-4">{c.share_percent}%</td>
                        <td className="py-2 pr-4">{c.monthly_amount === null ? "—" : usd(c.monthly_amount)}</td>
                        <td className="py-2">{c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Budget</dt>
                  <dd className="mt-1">
                    {plan.budget.monthly === null ? "—" : `${usd(plan.budget.monthly)} / month (about ${usd(plan.budget.daily ?? 0)} / day)`}
                    {plan.budget_covers_appointments !== null
                      ? ` — at your target cost, that budget covers up to ${plan.budget_covers_appointments} booked appointments a month.`
                      : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Landing page</dt>
                  <dd className="mt-1">
                    <span className="font-medium text-slate-900">{plan.landing_page_label}</span> — {plan.template_reason}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Targeting</dt>
                  <dd className="mt-1">
                    {plan.targeting_notes}{" "}
                    <span className="text-slate-500">({plan.service_area_zip_codes.length} ZIP codes in your service area)</span>
                  </dd>
                </div>
              </dl>
              {plan.first_steps.length ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next steps</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5">
                    {plan.first_steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {isOwner ? <RegeneratePlanButton>Create a new plan</RegeneratePlanButton> : null}
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-500">
              <p>No plan yet. Fill in your jobs, area, hours and budget above, then create one.</p>
              {isOwner ? <RegeneratePlanButton>Create plan</RegeneratePlanButton> : null}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
