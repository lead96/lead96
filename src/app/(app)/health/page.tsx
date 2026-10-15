import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, cx, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { HEALTH_CHECKS, HEALTH_ORDER, healthScore, type HealthCheck, type HealthRow } from "@/lib/health/checks";
import { SOURCE_LABELS, type LeadSource } from "@/lib/leads/normalize";
import { createClient } from "@/lib/supabase/server";
import { DuplicateActions } from "./forms";

export const metadata: Metadata = { title: "Data health" };

const DAYS = 90;

export default async function HealthPage({ searchParams }: PageProps<"/health">) {
  const workspace = await requireWorkspace();
  const sp = await searchParams;
  const open: HealthCheck | null = typeof sp.check === "string" && sp.check in HEALTH_CHECKS ? (sp.check as HealthCheck) : null;
  const since = new Date(new Date().getTime() - DAYS * 86_400_000).toISOString();
  const supabase = await createClient();

  const [{ data: counts, error }, { data: list }] = await Promise.all([
    supabase.rpc("data_health", { p_workspace: workspace.id, p_since: since }),
    open ? supabase.rpc("data_health_list", { p_workspace: workspace.id, p_check: open, p_since: since }) : Promise.resolve({ data: null }),
  ]);
  const n = (counts ?? {}) as Partial<Record<HealthCheck, number>>;
  const rows = (list ?? []) as HealthRow[];
  const score = healthScore(n);

  const ids = [...new Set(rows.flatMap((r) => [r.customer_id, r.other_customer_id]).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("customers").select("id, full_name, phone, email").in("id", ids) : { data: [] };
  const nameOf = (id: string | null | undefined) => {
    const c = (people ?? []).find((p) => p.id === id);
    return c ? c.full_name || formatPhone(c.phone) || c.email || "Customer" : "Unknown caller";
  };
  const tz = workspace.timezone;
  const detail = (check: HealthCheck, r: HealthRow) => {
    if (!r.detail) return null;
    if (check === "missing_source" || check === "lead_no_consent") return SOURCE_LABELS[r.detail as LeadSource] ?? r.detail;
    if (check === "visit_no_outcome") return r.detail === "confirmed" ? "Confirmed" : "Booked";
    if (check === "duplicates") return r.detail === "phone and email match different customers" ? "Phone matches one, email the other" : r.detail;
    return r.detail;
  };
  const link = (check: HealthCheck, r: HealthRow) =>
    r.call_id ? { href: `/calls/${r.call_id}`, label: "Open call" } : check === "visit_no_outcome" ? { href: "/outcomes", label: "Record result" } : null;

  return (
    <>
      <PageHeader
        title="Data health"
        description={`What is missing or doesn't add up, so your numbers can be trusted. Leads and calls from the last ${DAYS} days; visits and won jobs of any age.`}
      />

      {error ? (
        <div className="mb-6">
          <Alert tone="error">The checks could not be loaded. Please refresh the page.</Alert>
        </div>
      ) : (
        <p className={cx("mb-6 flex items-center gap-2 text-sm font-medium", score.failing ? "text-amber-800" : "text-emerald-700")}>
          {score.failing ? <CircleAlert size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          {score.failing ? `${score.failing} of ${score.total} checks need attention` : "All checks pass"}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {HEALTH_ORDER.map((k) => {
          const c = HEALTH_CHECKS[k];
          const count = n[k] ?? 0;
          const bad = !c.info && count > 0;
          const Icon = c.info ? Info : bad ? CircleAlert : CheckCircle2;
          return (
            <Link
              key={k}
              href={open === k ? "/health" : `/health?check=${k}`}
              scroll={false}
              aria-current={open === k ? "true" : undefined}
              className={cx(
                "block rounded-xl border bg-white p-5 shadow-xs transition hover:border-brand-600/40",
                open === k ? "border-brand-600 ring-2 ring-brand-600/15" : "border-slate-200/80",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{c.label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{c.explain}</p>
                </div>
                <span className={cx("flex shrink-0 items-center gap-1.5 text-2xl font-semibold tabular-nums", bad ? "text-amber-700" : c.info ? "text-slate-700" : "text-emerald-700")}>
                  <Icon size={18} aria-hidden />
                  {count}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {open ? (
        <section aria-labelledby="list-h" className="mt-8">
          <div className="mb-3">
            <h2 id="list-h" className="text-base font-semibold text-slate-900">
              {HEALTH_CHECKS[open].label}
            </h2>
            <p className="text-sm text-slate-500">{HEALTH_CHECKS[open].fix}</p>
          </div>
          <Card className="divide-y divide-slate-100">
            {!rows.length ? <p className="px-6 py-6 text-sm text-slate-500">Nothing here.</p> : null}
            {rows.map((r, i) => {
              const l = link(open, r);
              return (
                <div key={`${r.customer_id}-${r.other_customer_id ?? r.call_id ?? r.lead_id ?? r.appointment_id ?? i}`} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-900">
                      {r.customer_id ? (
                        <Link href={`/leads/${r.customer_id}`} className="hover:text-brand-700">
                          {nameOf(r.customer_id)}
                        </Link>
                      ) : (
                        "Unknown caller"
                      )}
                      {r.other_customer_id ? (
                        <>
                          <span className="font-normal text-slate-500"> and </span>
                          <Link href={`/leads/${r.other_customer_id}`} className="hover:text-brand-700">
                            {nameOf(r.other_customer_id)}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="text-slate-500">{[formatDateTime(r.at, tz), detail(open, r)].filter(Boolean).join(" · ")}</p>
                  </div>
                  {open === "duplicates" && r.customer_id && r.other_customer_id ? (
                    <DuplicateActions a={{ id: r.customer_id, name: nameOf(r.customer_id) }} b={{ id: r.other_customer_id, name: nameOf(r.other_customer_id) }} />
                  ) : l ? (
                    <Link href={l.href} className="shrink-0 text-sm font-medium text-brand-700 hover:underline">
                      {l.label}
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </Card>
          {rows.length >= 100 ? <p className="mt-2 text-xs text-slate-500">Showing the latest 100.</p> : null}
        </section>
      ) : null}
    </>
  );
}
