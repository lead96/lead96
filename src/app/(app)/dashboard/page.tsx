import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, Calculator, DollarSign, ListChecks, PanelsTopLeft, Trophy, Upload, UserCheck, UserPlus, Users } from "lucide-react";
import { ActionCard, Badge, Card, IconTile, PageHeader, Section, StatCard, buttonClass } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatPhone, timeAgo } from "@/lib/format";
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, type CustomerStatus, type LeadSource } from "@/lib/leads/normalize";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

const DAYS = 30;
// A customer counts at a stage once their status has reached it.
const QUALIFIED: CustomerStatus[] = ["qualified", "appointment", "showed", "estimate", "won"];
const BOOKED: CustomerStatus[] = ["appointment", "showed", "estimate", "won"];

/** Start of the reporting window. A server component renders once per request, so this is stable. */
function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

type Recent = { id: string; full_name: string | null; phone: string | null; email: string | null; status: CustomerStatus; last_lead_at: string | null };

export default async function DashboardPage() {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const needsSetup = !workspace.setupCompletedAt;
  const since = daysAgo(DAYS);
  const supabase = await createClient();

  const [{ data: cohort }, { data: recent }, { data: sourceRows }, { count: total }] = await Promise.all([
    supabase.from("customers").select("status").eq("workspace_id", workspace.id).is("merged_into", null).gte("first_lead_at", since).limit(10000),
    supabase
      .from("customers")
      .select("id, full_name, phone, email, status, last_lead_at")
      .eq("workspace_id", workspace.id)
      .is("merged_into", null)
      .order("last_lead_at", { ascending: false, nullsFirst: false })
      .limit(5),
    supabase.from("leads").select("source").eq("workspace_id", workspace.id).gte("received_at", since).limit(10000),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
  ]);

  const statuses = (cohort ?? []).map((c) => c.status as CustomerStatus);
  const count = (set: CustomerStatus[]) => statuses.filter((s) => set.includes(s)).length;
  const bySource = new Map<LeadSource, number>();
  for (const r of sourceRows ?? []) bySource.set(r.source as LeadSource, (bySource.get(r.source as LeadSource) ?? 0) + 1);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  const maxSource = sources[0]?.[1] ?? 1;
  const footer = `Last ${DAYS} days`;

  return (
    <>
      <PageHeader title="Dashboard" description="Leads, bookings, jobs and revenue by source." />

      {needsSetup && isOwner ? (
        <Card className="mb-10 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <IconTile icon={ListChecks} tone="green" />
          <div className="flex-1">
            <p className="font-semibold text-slate-900">Finish setting up your business</p>
            <p className="text-sm text-slate-500">Tell us your services, area and hours so the AI can call and book your leads.</p>
          </div>
          <Link href="/setup" className={buttonClass("primary", "max-sm:w-full")}>
            Continue setup
          </Link>
        </Card>
      ) : null}

      <Section title="Overview" description={`New customers in the last ${DAYS} days and how far they got.`}>
      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6">
        <StatCard icon={Users} title="Leads" subtitle="New people who contacted you" value={statuses.length} footer={footer} />
        <StatCard icon={UserCheck} title="Qualified" subtitle="A good fit for your services" value={count(QUALIFIED)} footer={footer} />
        <StatCard icon={CalendarCheck} title="Booked" subtitle="Appointment set" value={count(BOOKED)} footer={footer} />
        <StatCard icon={Trophy} title="Won" subtitle="Became a paying job" value={count(["won"])} footer={footer} tone="green" />
        <StatCard icon={DollarSign} title="Revenue" subtitle="From won jobs" value="-" footer="Coming soon" tone="slate" muted />
        <StatCard icon={Calculator} title="Cost per booking" subtitle="Ad spend / appointments" value="-" footer="Coming soon" tone="slate" muted />
      </div>
      </Section>

      {!total ? (
        <Section className="mt-12" title="Get your first lead" description="Every lead and call lands in one inbox, and the numbers above fill in on their own.">
          <div className="grid gap-4 sm:grid-cols-3 lg:gap-6">
            {isOwner ? (
              <>
                <ActionCard href="/landing-pages" icon={PanelsTopLeft} title="Publish a landing page" description="Pick a template, add your phone and go live in minutes." />
                <ActionCard href="/leads/import" icon={Upload} title="Import your leads" description="Bring in a CSV from a spreadsheet or your old CRM." />
              </>
            ) : null}
            <ActionCard href="/leads/new" icon={UserPlus} title="Add a lead by hand" description="A walk-in, a referral or a call to your own number." />
          </div>
        </Section>
      ) : (
        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Recent leads</h2>
              <Link href="/leads" className="text-sm font-medium text-brand-700 hover:underline">
                View all
              </Link>
            </div>
            <ul className="divide-y divide-slate-100">
              {((recent ?? []) as Recent[]).map((c) => (
                <li key={c.id}>
                  <Link href={`/leads/${c.id}`} className="flex items-center gap-3 px-6 py-3.5 hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{c.full_name || formatPhone(c.phone) || c.email}</span>
                      <span className="block truncate text-xs text-slate-500">{c.full_name ? formatPhone(c.phone) || c.email : c.email}</span>
                    </span>
                    <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    <span className="hidden w-20 text-right text-xs text-slate-500 sm:block">{c.last_lead_at ? timeAgo(c.last_lead_at, workspace.timezone) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Leads by source</h2>
              <p className="text-xs text-slate-500">{footer}</p>
            </div>
            {sources.length ? (
              <ul className="space-y-4 px-6 py-5">
                {sources.map(([source, n]) => (
                  <li key={source}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-slate-700">{SOURCE_LABELS[source] ?? source}</span>
                      <span className="font-medium tabular-nums text-slate-900">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(4, (n / maxSource) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-6 py-6 text-sm text-slate-500">No leads in the last {DAYS} days.</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
