import { ArrowRight, History } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { ACTION_LABELS, fieldChanges, rowLabel, TABLE_LABELS } from "@/lib/history";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Change history" };

const TZ = "America/New_York";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: number;
  workspace_id: string | null;
  table_name: string;
  row_id: string;
  action: "insert" | "update" | "delete";
  actor_id: string | null;
  via: "user" | "system";
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  at: string;
};

const TONE = { insert: "green", update: "blue", delete: "red" } as const;

export default async function ChangeHistoryPage({ searchParams }: PageProps<"/admin/history">) {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");
  const sp = await searchParams;
  const business = typeof sp.business === "string" && UUID.test(sp.business) ? sp.business : "";
  const table = typeof sp.table === "string" && sp.table in TABLE_LABELS ? sp.table : "";
  const who = typeof sp.who === "string" && (sp.who === "system" || UUID.test(sp.who)) ? sp.who : "";

  // Read through RLS (platform admins may read all history).
  const supabase = await createClient();
  let q = supabase.from("change_log").select("*").order("id", { ascending: false }).limit(200);
  if (business) q = q.eq("workspace_id", business);
  if (table) q = q.eq("table_name", table);
  if (who === "system") q = q.eq("via", "system");
  else if (who) q = q.eq("actor_id", who);
  const { data } = await q;
  const rows = (data ?? []) as Row[];

  const db = createAdminClient();
  const [{ data: businesses }, { data: people }] = await Promise.all([
    db.from("workspaces").select("id, name").order("name"),
    db.from("profiles").select("id, email").order("email"),
  ]);
  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  // Updates store only the changed fields: name those rows from the values they were created with.
  const unnamed = rows.filter((r) => !rowLabel(r.table_name, r.action === "delete" ? r.old_values : r.new_values)).map((r) => r.row_id);
  const createdAs = new Map<string, string>();
  if (unnamed.length) {
    const { data: created } = await supabase
      .from("change_log")
      .select("table_name, row_id, new_values")
      .eq("action", "insert")
      .in("row_id", [...new Set(unnamed)].slice(0, 200));
    for (const c of created ?? []) {
      const l = rowLabel(c.table_name, c.new_values as Record<string, unknown> | null);
      if (l) createdAs.set(`${c.table_name}:${c.row_id}`, l);
    }
  }
  const email = new Map((people ?? []).map((p) => [p.id, p.email]));

  return (
    <>
      <PageHeader
        title="Change history"
        description="Every change to businesses, customers, leads, calls, texts, pages, setup, numbers and users: who, when, and the old and new values. It cannot be edited or deleted."
        back={{ href: "/admin", label: "Admin" }}
      />

      <form method="get" className="mb-6 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,14rem))_auto] sm:items-center">
        <Select name="business" defaultValue={business} aria-label="Business">
          <option value="">All businesses</option>
          {(businesses ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select name="table" defaultValue={table} aria-label="What">
          <option value="">Everything</option>
          {Object.entries(TABLE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="who" defaultValue={who} aria-label="Who">
          <option value="">Anyone</option>
          <option value="system">System (webhooks, jobs)</option>
          {(people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.email}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm" className="justify-self-start">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="No changes found" description="Changes are recorded from October 15, 2026 on." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const values = r.action === "delete" ? r.old_values : r.new_values;
              const label = rowLabel(r.table_name, values) ?? createdAs.get(`${r.table_name}:${r.row_id}`) ?? null;
              const changes = r.action === "update" ? fieldChanges(r) : [];
              return (
                <li key={r.id} className="px-5 py-3.5" data-change={r.id}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={TONE[r.action]}>{ACTION_LABELS[r.action]}</Badge>
                    <span className="font-medium text-slate-900">
                      {TABLE_LABELS[r.table_name] ?? r.table_name}
                      {label ? `: ${label}` : ""}
                    </span>
                    <span className="text-slate-500">
                      by {r.via === "system" ? "System" : (email.get(r.actor_id ?? "") ?? "a deleted user")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDateTime(r.at, TZ)} ET
                    {r.workspace_id ? ` · ${businessName.get(r.workspace_id) ?? "Deleted business"}` : ""}
                  </p>
                  {changes.length ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {changes.map((c) => (
                        <li key={c.field} className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-600">{c.field}:</span>
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300">{c.from}</span>
                          <ArrowRight size={12} className="text-slate-400" aria-hidden />
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-400">Latest 200 changes for this filter.</p>
    </>
  );
}
