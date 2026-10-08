import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { buildIntegrations, overallState, type HealthReport, type HealthState, type Integration } from "@/lib/admin/health";
import { getProfile } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LiveChecks } from "./live-checks";

export const metadata: Metadata = { title: "Admin" };

// Platform admins are Husam and Riku; times are shown in US Eastern.
const TZ = "America/New_York";

const STATE: Record<HealthState, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  ok: { label: "Working", tone: "green" },
  warning: { label: "Warning", tone: "amber" },
  error: { label: "Failing", tone: "red" },
  idle: { label: "No traffic", tone: "slate" },
  setup: { label: "Not set up", tone: "blue" },
};

type Delivery = {
  id: number;
  provider: string;
  external_id: string | null;
  status: "processed" | "duplicate" | "rejected" | "failed";
  error: string | null;
  attempt: number;
  received_at: string;
  payload: unknown;
  workspaces: { name: string } | null;
};
const DELIVERY_TONE = { processed: "green", duplicate: "slate", rejected: "amber", failed: "red" } as const;

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");
  const problemsOnly = (await searchParams).deliveries === "problems";
  const supabase = await createClient();

  let deliveries = supabase
    .from("webhook_deliveries")
    .select("id, provider, external_id, status, error, attempt, received_at, payload, workspaces(name)")
    .order("id", { ascending: false })
    .limit(50);
  if (problemsOnly) deliveries = deliveries.in("status", ["failed", "rejected"]);
  const [{ data: report, error }, { data: rows }] = await Promise.all([supabase.rpc("admin_integration_health"), deliveries]);

  if (error || !report) {
    return (
      <>
        <PageHeader title="Admin" />
        <Alert tone="error">Could not load integration health: {error?.message ?? "no data"}.</Alert>
      </>
    );
  }
  const r = report as HealthReport;
  const env = serverEnv() as Record<string, unknown>;
  const integrations = buildIntegrations(r, (key) => Boolean(env[key]));
  const overall = overallState(integrations);
  const ago = (iso: string | null | undefined) => (iso ? timeAgo(iso, TZ) : "—");

  return (
    <>
      <PageHeader
        title="Admin"
        description="Integration health across all businesses."
        actions={
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge tone={STATE[overall].tone}>{STATE[overall].label}</Badge>
            <span>Updated {formatDateTime(r.generated_at, TZ)} ET</span>
          </div>
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="health-h">
          <h2 id="health-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Integration health
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {integrations.map((i) => (
              <IntegrationCard key={i.key} integration={i} ago={ago} />
            ))}
          </div>
        </section>

        <LiveChecks />

        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">Businesses ({r.workspaces.length})</h2>
          {r.workspaces.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No businesses yet.</p>
          ) : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Business</th>
                  <th className="px-5 py-2 font-medium">Setup</th>
                  <th className="px-5 py-2 text-right font-medium">Leads 7 days</th>
                  <th className="px-5 py-2 text-right font-medium">Last lead</th>
                  <th className="px-5 py-2 text-right font-medium">Live pages</th>
                  <th className="px-5 py-2 text-right font-medium">Problems 7 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.workspaces.map((w) => (
                  <tr key={w.id}>
                    <td className="px-5 py-2 font-medium text-slate-900">{w.name}</td>
                    <td className="px-5 py-2">{w.setup_completed_at ? <Badge tone="green">Done</Badge> : <Badge>Not finished</Badge>}</td>
                    <td className="px-5 py-2 text-right">{w.leads_7d}</td>
                    <td className="px-5 py-2 text-right text-slate-600">{ago(w.last_lead_at)}</td>
                    <td className="px-5 py-2 text-right">{w.published_pages}</td>
                    <td className="px-5 py-2 text-right">{w.problems_7d ? <Badge tone="red">{w.problems_7d}</Badge> : <span className="text-slate-400">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold text-slate-900">Recent webhook deliveries</h2>
            <nav className="flex gap-1 text-sm" aria-label="Delivery filter">
              <FilterLink href="/admin" active={!problemsOnly}>
                All
              </FilterLink>
              <FilterLink href="/admin?deliveries=problems" active={problemsOnly}>
                Problems
              </FilterLink>
            </nav>
          </div>
          {!rows?.length ? (
            <p className="p-6 text-sm text-slate-500">{problemsOnly ? "No failed or rejected deliveries." : "No deliveries yet. Calls appear here once AI voice is connected."}</p>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Received</th>
                  <th className="px-5 py-2 font-medium">Source</th>
                  <th className="px-5 py-2 font-medium">Business</th>
                  <th className="px-5 py-2 font-medium">Outcome</th>
                  <th className="px-5 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {(rows as unknown as Delivery[]).map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">{formatDateTime(d.received_at, TZ)}</td>
                    <td className="px-5 py-2 capitalize">{d.provider}</td>
                    <td className="px-5 py-2">{d.workspaces?.name ?? <span className="text-slate-400">Unknown</span>}</td>
                    <td className="px-5 py-2">
                      <Badge tone={DELIVERY_TONE[d.status]}>{d.status}</Badge>
                      {d.attempt > 1 ? <span className="ml-1 text-xs text-slate-500"> attempt {d.attempt}</span> : null}
                    </td>
                    <td className="px-5 py-2">
                      {d.error ? <p className="text-red-700">{d.error}</p> : null}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-brand-700">{d.external_id ?? "payload"}</summary>
                        <pre className="mt-1 max-h-64 max-w-[520px] overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                          {JSON.stringify(d.payload, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function IntegrationCard({ integration: i, ago }: { integration: Integration; ago: (iso: string | null) => string }) {
  const s = STATE[i.state];
  return (
    <Card className="flex flex-col p-5" data-integration={i.key}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900">{i.name}</h3>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="mb-4 text-sm text-slate-600">{i.summary}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {i.stats.map((st) => (
          <div key={st.label}>
            <dt className="text-xs text-slate-500">{st.label}</dt>
            <dd className="font-medium text-slate-900">
              {st.time ? ago(st.value as string | null) : typeof st.value === "number" ? st.value.toLocaleString("en-US") : (st.value ?? "—")}
            </dd>
          </div>
        ))}
      </dl>
      {i.problem ? (
        <div className="mt-4 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-medium">
            Last problem · {ago(i.problem.at)} · {i.problem.status}
          </p>
          {i.problem.error ? <p className="mt-0.5 break-words">{i.problem.error}</p> : null}
        </div>
      ) : null}
      {i.config ? (
        <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs">
          {i.config.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span aria-hidden className={c.set ? "text-emerald-600" : "text-slate-400"}>
                {c.set ? "✓" : "○"}
              </span>
              <span className={c.set ? "text-slate-700" : "text-slate-500"}>{c.label}</span>
              <code className="ml-auto text-[10px] text-slate-400">{c.key}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded px-2.5 py-1 ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
