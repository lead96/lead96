import { CalendarCheck2, CircleDollarSign, ClipboardCheck, Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { STATUS_LABELS, STATUS_TONES, type CustomerStatus } from "@/lib/leads/normalize";
import { FINAL_STATUSES, money } from "@/lib/leads/outcomes";
import { visitWhen } from "@/lib/notify/visits";
import { createClient } from "@/lib/supabase/server";
import { StatusForm } from "../leads/[id]/forms";
import { VisitResultButtons } from "./forms";

export const metadata: Metadata = { title: "Outcomes" };

type Customer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: CustomerStatus;
  estimate_amount: number | null;
  revenue: number | null;
  lost_reason: string | null;
  not_qualified_reason: string | null;
};
type Visit = { id: string; starts_at: string; ends_at: string; status: string; address: string | null; customers: Customer | null };

const DAY = 86_400_000;
/** A visit is "mature" a week after it ended: by then it should have a final result. */
const MATURE_DAYS = 7;
const TARGET = 80;

export default async function OutcomesPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const now = new Date().getTime();
  const cols = "id, starts_at, ends_at, status, address, customers (id, full_name, phone, status, estimate_amount, revenue, lost_reason, not_qualified_reason)";

  const [{ data: due }, { data: done }, { data: mature }] = await Promise.all([
    supabase
      .from("appointments")
      .select(cols)
      .eq("workspace_id", workspace.id)
      .in("status", ["scheduled", "confirmed"])
      .lt("ends_at", new Date(now - 3_600_000).toISOString())
      .order("starts_at")
      .limit(100),
    supabase
      .from("appointments")
      .select(cols.replace("customers (", "customers!inner ("))
      .eq("workspace_id", workspace.id)
      .eq("status", "completed")
      .not("customers.status", "in", `(${FINAL_STATUSES.join(",")})`)
      .order("ends_at", { ascending: false })
      .limit(200),
    // Last 90 days of visits that should have a result by now.
    supabase
      .from("appointments")
      .select("status, customers (status)")
      .eq("workspace_id", workspace.id)
      .neq("status", "cancelled")
      .lt("ends_at", new Date(now - MATURE_DAYS * DAY).toISOString())
      .gt("ends_at", new Date(now - 90 * DAY).toISOString()),
  ]);
  const visitsDue = (due ?? []) as unknown as Visit[];
  // One row per customer (their latest finished visit).
  const seen = new Set<string>();
  const jobsDue = ((done ?? []) as unknown as Visit[]).filter((v) => v.customers && !seen.has(v.customers.id) && seen.add(v.customers.id)).reverse();
  const matureRows = (mature ?? []) as unknown as { status: string; customers: { status: CustomerStatus } | null }[];
  const final = matureRows.filter((r) => r.status === "no_show" || (r.customers && FINAL_STATUSES.includes(r.customers.status))).length;
  const rate = matureRows.length ? Math.round((final / matureRows.length) * 100) : null;

  const tz = workspace.timezone;
  const name = (c: Customer | null) => c?.full_name || formatPhone(c?.phone) || "Unknown customer";
  // Calendar days in the business's time zone: a visit yesterday afternoon is "yesterday".
  const localDay = (ms: number) => Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(ms));
  const age = (iso: string) => {
    const d = Math.round((localDay(now) - localDay(Date.parse(iso))) / DAY);
    return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
  };

  return (
    <>
      <PageHeader
        title="Outcomes"
        description="Record what happened after each visit. Your results by source and your cost per booked job are only as good as these answers."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard icon={CalendarCheck2} title="Visits to close" subtitle="Past visits still marked as booked" value={visitsDue.length} footer="Mark each one done, no-show or did not happen" muted={!visitsDue.length} />
        <StatCard icon={CircleDollarSign} title="Jobs to close" subtitle="Done visits without won / lost" value={jobsDue.length} footer="Record won, lost or the estimate" muted={!jobsDue.length} />
        <StatCard
          icon={Gauge}
          tone={rate !== null && rate >= TARGET ? "green" : "blue"}
          title="Visits with a final result"
          subtitle={`Visits older than ${MATURE_DAYS} days, last 90 days`}
          value={rate === null ? "-" : `${rate}%`}
          footer={rate === null ? "No visits old enough yet" : `${final} of ${matureRows.length} · target ${TARGET}%`}
          muted={rate === null}
        />
      </div>

      {!visitsDue.length && !jobsDue.length ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title="All caught up" description="Every past visit has a result. New ones show up here after the visit's time has passed." />
        </Card>
      ) : (
        <div className="space-y-8">
          {visitsDue.length ? (
            <section aria-labelledby="visits-h">
              <h2 id="visits-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Did the visit happen?
              </h2>
              <Card className="divide-y divide-slate-100">
                {visitsDue.map((v) => (
                  <div key={v.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      {v.customers ? (
                        <Link href={`/leads/${v.customers.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {name(v.customers)}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">Unknown customer</span>
                      )}
                      <p className="text-sm text-slate-500">
                        {visitWhen(v.starts_at, v.ends_at, tz)} · {age(v.ends_at)}
                        {v.address ? ` · ${v.address}` : ""}
                      </p>
                    </div>
                    <VisitResultButtons id={v.id} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}

          {jobsDue.length ? (
            <section aria-labelledby="jobs-h">
              <h2 id="jobs-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Job result
              </h2>
              <Card className="divide-y divide-slate-100">
                {jobsDue.map((v) => {
                  const c = v.customers!;
                  return (
                    <div key={v.id} className="grid gap-3 p-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_360px] md:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/leads/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                            {name(c)}
                          </Link>
                          <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                          {now - Date.parse(v.ends_at) > 14 * DAY ? <Badge tone="amber">Over 2 weeks</Badge> : null}
                        </div>
                        <p className="text-sm text-slate-500">
                          Visit {visitWhen(v.starts_at, v.ends_at, tz)} · {age(v.ends_at)}
                          {c.estimate_amount !== null ? ` · estimate ${money(c.estimate_amount)}` : ""}
                        </p>
                      </div>
                      <StatusForm
                        key={c.status}
                        customerId={c.id}
                        status={c.status}
                        amount={c.estimate_amount}
                        compact
                      />
                    </div>
                  );
                })}
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
