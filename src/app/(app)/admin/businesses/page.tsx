import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { formatDateTime, timeAgo } from "@/lib/format";
import { money } from "@/lib/leads/outcomes";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "All businesses" };

// Platform admins are Husam and Riku; times are shown in US Eastern.
const TZ = "America/New_York";

type Business = {
  id: string;
  name: string;
  created_at: string;
  setup_completed_at: string | null;
  owners: string | null;
  members: number;
  leads_30d: number;
  calls_30d: number;
  booked_30d: number;
  won_30d: number;
  revenue_30d: number;
  open_reviews: number;
  pending_outcomes: number;
  health_problems: number;
  contact_no_consent: number;
  errors_7d: number;
  last_activity: string | null;
};
type Failure = { kind: string; at: string; workspace_id: string | null; ref: string; customer_id: string | null; message: string };
type Audit = { id: number; workspace_id: string | null; actor_id: string | null; action: string; target: string | null; created_at: string };

const KIND_LABELS: Record<string, string> = { call: "AI call", call_job: "Call job", email: "Email", text: "Text", webhook: "Webhook" };

export default async function AdminBusinessesPage() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: overview, error }, { data: feed }, { data: audit }] = await Promise.all([
    supabase.rpc("admin_business_overview"),
    supabase.rpc("admin_error_feed", { p_limit: 50 }),
    // Sign-ups and accepted invites are routine (and most of the log); the rest is what admins and owners changed.
    supabase
      .from("audit_log")
      .select("id, workspace_id, actor_id, action, target, created_at")
      .not("action", "in", "(workspace.create,invite.accept)")
      .order("id", { ascending: false })
      .limit(50),
  ]);
  const businesses = (overview ?? []) as Business[];
  const failures = (feed ?? []) as Failure[];
  const audits = (audit ?? []) as Audit[];
  const nameOf = new Map(businesses.map((b) => [b.id, b.name]));
  const actorIds = [...new Set(audits.map((a) => a.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await createAdminClient().from("profiles").select("id, email").in("id", actorIds) : { data: [] };
  const emailOf = (id: string | null) => (actors ?? []).find((a) => a.id === id)?.email ?? (id ? "deleted user" : "system");
  const n = (v: number) => (v ? v : <span className="text-slate-400">0</span>);

  return (
    <>
      <PageHeader
        title="All businesses"
        description="Pipeline, open work and problems for every business, the latest failures and admin actions."
        back={{ href: "/admin", label: "Admin" }}
      />
      {error ? (
        <div className="mb-6">
          <Alert tone="error">Could not load the overview: {error.message}</Alert>
        </div>
      ) : null}

      <div className="space-y-8">
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">Businesses ({businesses.length})</h2>
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-5 py-2 font-medium">Business</th>
                <th className="px-3 py-2 text-right font-medium">Leads 30d</th>
                <th className="px-3 py-2 text-right font-medium">AI calls</th>
                <th className="px-3 py-2 text-right font-medium">Booked</th>
                <th className="px-3 py-2 text-right font-medium">Won</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">To review</th>
                <th className="px-3 py-2 text-right font-medium">No result</th>
                <th className="px-3 py-2 text-right font-medium">Health</th>
                <th className="px-3 py-2 text-right font-medium">Errors 7d</th>
                <th className="px-5 py-2 text-right font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {businesses.map((b) => (
                <tr key={b.id} className="align-top">
                  <td className="px-5 py-2.5">
                    <Link href={`/admin/history?business=${b.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {b.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {b.owners ?? "no owner"} · {b.members} {b.members === 1 ? "member" : "members"}
                      {b.setup_completed_at ? "" : " · setup not finished"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{n(b.leads_30d)}</td>
                  <td className="px-3 py-2.5 text-right">{n(b.calls_30d)}</td>
                  <td className="px-3 py-2.5 text-right">{n(b.booked_30d)}</td>
                  <td className="px-3 py-2.5 text-right">{n(b.won_30d)}</td>
                  <td className="px-3 py-2.5 text-right">{b.revenue_30d ? money(b.revenue_30d) : <span className="text-slate-400">-</span>}</td>
                  <td className="px-3 py-2.5 text-right">{b.open_reviews ? <Badge tone="amber">{b.open_reviews}</Badge> : n(0)}</td>
                  <td className="px-3 py-2.5 text-right">{b.pending_outcomes ? <Badge tone="amber">{b.pending_outcomes}</Badge> : n(0)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {b.contact_no_consent ? (
                      <Badge tone="red">Consent</Badge>
                    ) : b.health_problems ? (
                      <Badge tone="amber">{b.health_problems}</Badge>
                    ) : (
                      <Badge tone="green">OK</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">{b.errors_7d ? <Badge tone="red">{b.errors_7d}</Badge> : n(0)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600">{b.last_activity ? timeAgo(b.last_activity, TZ) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            Health = data health checks with problems (Consent = someone was called or texted without consent). No result = past visits and done jobs
            without an outcome. Click a business for its change history.
          </p>
        </Card>

        <div className="grid gap-8 xl:grid-cols-2">
          <Card className="overflow-x-auto">
            <h2 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">Latest failures</h2>
            {failures.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {failures.map((f) => (
                  <li key={`${f.kind}-${f.ref}`} className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="red">{KIND_LABELS[f.kind] ?? f.kind}</Badge>
                      <span className="font-medium text-slate-900">{f.workspace_id ? (nameOf.get(f.workspace_id) ?? "Deleted business") : "No business"}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(f.at, TZ)} ET</span>
                    </div>
                    <p className="mt-0.5 break-words text-slate-600">{f.message.slice(0, 300)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-slate-500">No failures.</p>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Admin actions</h2>
              <p className="text-xs text-slate-500">Latest 50, without sign-ups and accepted invites.</p>
            </div>
            {audits.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {audits.map((a) => (
                  <li key={a.id} className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-700">{a.action}</span>
                      {a.workspace_id ? <span className="text-slate-900">{nameOf.get(a.workspace_id) ?? "Deleted business"}</span> : null}
                    </div>
                    <p className="text-xs text-slate-500">
                      {emailOf(a.actor_id)} · {formatDateTime(a.created_at, TZ)} ET{a.target ? ` · ${a.target.slice(0, 60)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-slate-500">No admin actions yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
