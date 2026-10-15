import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, Calculator, DollarSign, ListChecks, PanelsTopLeft, Trophy, Upload, UserCheck, UserPlus, Users } from "lucide-react";
import { ActionCard, Alert, Badge, Card, IconTile, PageHeader, Section, StatCard, buttonClass, cx } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatPhone, timeAgo } from "@/lib/format";
import {
  buildAttribution,
  buildLines,
  DIMENSIONS,
  periodFor,
  RANGES,
  rate,
  type AttributionRow,
  type CampaignSpend,
  type Dimension,
  type RangeKey,
  type Report,
} from "@/lib/dashboard/report";
import { STATUS_LABELS, STATUS_TONES, type CustomerStatus } from "@/lib/leads/normalize";
import { money } from "@/lib/leads/outcomes";
import { createClient } from "@/lib/supabase/server";

const COLUMNS = ["Leads", "Qualified", "Booked", "Showed", "Won", "Revenue", "Ad spend", "Per lead", "Per booking"];

/** "2026-10-01" -> "Oct 1". */
function formatDay(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export const metadata: Metadata = { title: "Dashboard" };

type Recent = { id: string; full_name: string | null; phone: string | null; email: string | null; status: CustomerStatus; last_lead_at: string | null };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const needsSetup = !workspace.setupCompletedAt;
  const sp = await searchParams;
  const period = periodFor(String(sp.range ?? ""), workspace.timezone);
  const by: Dimension = typeof sp.by === "string" && sp.by in DIMENSIONS ? (sp.by as Dimension) : "source";
  /** Dashboard link keeping the other choice (period or breakdown). */
  const href = (range: RangeKey, dim: Dimension) => {
    const q = new URLSearchParams({ ...(range !== "30d" ? { range } : {}), ...(dim !== "source" ? { by: dim } : {}) }).toString();
    return q ? `/dashboard?${q}` : "/dashboard";
  };
  const supabase = await createClient();

  const [{ data: report, error }, { data: recent }, { count: total }, { data: attribution }] = await Promise.all([
    supabase.rpc("dashboard_report", {
      p_workspace: workspace.id,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_from_date: period.fromDate,
      p_to_date: period.toDate,
    }),
    supabase
      .from("customers")
      .select("id, full_name, phone, email, status, last_lead_at")
      .eq("workspace_id", workspace.id)
      .is("merged_into", null)
      .order("last_lead_at", { ascending: false, nullsFirst: false })
      .limit(6),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    by === "source"
      ? Promise.resolve({ data: null })
      : supabase.rpc("attribution_report", {
          p_workspace: workspace.id,
          p_from: period.from.toISOString(),
          p_to: period.to.toISOString(),
          p_from_date: period.fromDate,
          p_to_date: period.toDate,
          p_dim: by,
        }),
  ]);
  const { lines, total: t } = buildLines(error || !report ? { channels: [], spend: [] } : (report as Report));
  const footer = period.label;
  const MAX_ROWS = 50;
  const attributed = by === "source" ? [] : buildAttribution(by, (attribution as { rows: AttributionRow[]; spend: CampaignSpend[] } | null) ?? { rows: [], spend: [] });
  const breakdown =
    by === "source"
      ? [...lines.map((l) => ({ ...l, key: l.channel, sub: null as string | null })), ...(lines.length > 1 ? [{ ...t, key: "total", label: "Total", sub: null }] : [])]
      : [
          ...attributed.slice(0, MAX_ROWS),
          ...(t.leads ? [{ ...t, key: "total", label: "Total", sub: null }] : []),
        ];
  const funnel = [
    { label: "Leads", n: t.leads, of: null },
    { label: "Qualified", n: t.qualified, of: t.leads },
    { label: "Booked", n: t.booked, of: t.qualified },
    { label: "Showed", n: t.showed, of: t.booked },
    { label: "Won", n: t.won, of: t.showed },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Leads, bookings, jobs and revenue by source."
        actions={
          <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Link
                key={k}
                href={href(k, by)}
                aria-current={k === period.key ? "page" : undefined}
                className={cx(
                  "rounded-md px-2.5 py-1 text-sm",
                  k === period.key ? "bg-white font-medium text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900",
                )}
              >
                {RANGES[k]}
              </Link>
            ))}
          </nav>
        }
      />

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

      {error ? (
        <div className="mb-6">
          <Alert tone="error">The numbers could not be loaded. Please refresh the page.</Alert>
        </div>
      ) : null}

      <Section title="Overview" description={`People whose first contact was in this period (${formatDay(period.fromDate)} - ${formatDay(period.toDate)}) and how far they got.`}>
        <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          <StatCard icon={Users} title="Leads" subtitle="New people who contacted you" value={t.leads} footer={footer} />
          <StatCard icon={UserCheck} title="Qualified" subtitle="A good fit for your services" value={t.qualified} footer={`${rate(t.qualified, t.leads)} of leads`} />
          <StatCard icon={CalendarCheck} title="Booked" subtitle="Visit booked" value={t.booked} footer={`${rate(t.booked, t.leads)} of leads`} />
          <StatCard icon={Trophy} title="Won" subtitle="Became a paying job" value={t.won} footer={`${rate(t.won, t.leads)} of leads`} tone="green" />
          <StatCard
            icon={DollarSign}
            title="Revenue"
            subtitle="From won jobs"
            value={money(t.revenue)}
            footer={t.won ? `${money(t.revenue / t.won)} per job` : footer}
            tone="green"
            muted={!t.revenue}
          />
          <StatCard
            icon={Calculator}
            title="Cost per booking"
            subtitle="Ad spend / booked visits (CPQBA)"
            value={t.costPerBooking !== null ? money(t.costPerBooking) : "-"}
            footer={t.spend !== null ? `Ad spend ${money(t.spend)}` : "No ad spend synced yet"}
            tone="slate"
            muted={t.costPerBooking === null}
          />
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
              <h2 className="text-base font-semibold text-slate-900">Funnel</h2>
              <p className="text-xs text-slate-500">{footer} · % of the step before</p>
            </div>
            <ul className="space-y-4 px-6 py-5">
              {funnel.map((f) => (
                <li key={f.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-700">{f.label}</span>
                    <span className="tabular-nums text-slate-900">
                      <span className="font-medium">{f.n}</span>
                      {f.of !== null ? <span className="ml-2 text-xs text-slate-500">{rate(f.n, f.of)}</span> : null}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${t.leads ? Math.max(f.n ? 3 : 0, (f.n / t.leads) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {total ? (
        <Section
          className="mt-12"
          title="Where results come from"
          description="By where each lead first came from. A landing page visit from a Google or Facebook ad counts as that ad."
        >
          <nav aria-label="Breakdown" className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {(Object.keys(DIMENSIONS) as Dimension[]).map((d) => (
              <Link
                key={d}
                href={href(period.key, d)}
                scroll={false}
                aria-current={d === by ? "page" : undefined}
                className={cx("rounded-md px-2.5 py-1 text-sm", d === by ? "bg-white font-medium text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900")}
              >
                {DIMENSIONS[d]}
              </Link>
            ))}
          </nav>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-6 py-3 font-medium">{DIMENSIONS[by]}</th>
                  {COLUMNS.map((h) => (
                    <th key={h} className="px-3 py-3 text-right font-medium last:pr-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {breakdown.map((l) => (
                  <tr key={l.key} className={l.key === "total" ? "bg-slate-50 font-medium" : undefined}>
                    <td className="max-w-[280px] px-6 py-3 text-slate-900">
                      <span className="block truncate" title={l.label}>
                        {l.label}
                      </span>
                      {l.sub ? <span className="block text-xs text-slate-500">{l.sub}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right">{l.leads}</td>
                    <td className="px-3 py-3 text-right">{l.qualified}</td>
                    <td className="px-3 py-3 text-right">{l.booked}</td>
                    <td className="px-3 py-3 text-right">{l.showed}</td>
                    <td className="px-3 py-3 text-right">{l.won}</td>
                    <td className="px-3 py-3 text-right">{l.revenue ? money(l.revenue) : "-"}</td>
                    <td className="px-3 py-3 text-right">{l.spend !== null ? money(l.spend) : "-"}</td>
                    <td className="px-3 py-3 text-right">{l.costPerLead !== null ? money(l.costPerLead) : "-"}</td>
                    <td className="px-3 py-3 pr-6 text-right">{l.costPerBooking !== null ? money(l.costPerBooking) : "-"}</td>
                  </tr>
                ))}
                {!breakdown.length ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-6 py-6 text-slate-500">
                      No new leads in this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <p className="mt-3 text-xs text-slate-500">
            Ad spend comes from connected Google Ads and Facebook accounts, per day and campaign, so ads, keywords and landing pages show no spend. Revenue
            counts won jobs from these leads, whenever they were won.
            {attributed.length > MAX_ROWS ? ` Showing the top ${MAX_ROWS} of ${attributed.length} rows by leads; the total counts all.` : ""}
          </p>
        </Section>
      ) : null}
    </>
  );
}
