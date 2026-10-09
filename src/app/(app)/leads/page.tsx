import Link from "next/link";
import type { Metadata } from "next";
import { Inbox, Phone, SearchX } from "lucide-react";
import { Badge, Card, EmptyState, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatPhone, timeAgo } from "@/lib/format";
import { CUSTOMER_STATUSES, LEAD_SOURCES, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, type CustomerStatus, type LeadSource } from "@/lib/leads/normalize";
import { loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 50;

type Row = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  zip: string | null;
  service: string | null;
  status: CustomerStatus;
  lead_count: number;
  last_lead_at: string | null;
};
type LatestLead = { customer_id: string; source: LeadSource; kind: string; campaign_name: string | null; utm_campaign: string | null; keyword: string | null };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = CUSTOMER_STATUSES.find((s) => s === sp.status);
  const source = LEAD_SOURCES.find((s) => s === sp.source);
  const supabase = await createClient();

  // Source filter: customers with at least one lead from that source.
  let sourceIds: string[] | null = null;
  if (source) {
    const { data } = await supabase.from("leads").select("customer_id").eq("workspace_id", workspace.id).eq("source", source).limit(1000);
    sourceIds = [...new Set((data ?? []).map((r) => r.customer_id as string))];
  }

  let query = supabase
    .from("customers")
    .select("id, full_name, phone, email, zip, service, status, lead_count, last_lead_at", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .is("merged_into", null)
    .order("last_lead_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);
  if (status) query = query.eq("status", status);
  if (sourceIds) query = query.in("id", sourceIds.length ? sourceIds : ["00000000-0000-0000-0000-000000000000"]);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    query = query.or(
      [`full_name.ilike.${like}`, `email.ilike.${like}`, digits.length >= 3 ? `phone.ilike.%${digits}%` : null].filter(Boolean).join(","),
    );
  }

  const [{ data, count }, ctx] = await Promise.all([query, loadSetupContext(supabase, workspace)]);
  const rows = (data ?? []) as Row[];

  // Latest lead per customer, for the Source column.
  const latest = new Map<string, LatestLead>();
  if (rows.length) {
    const { data: leads } = await supabase
      .from("leads")
      .select("customer_id, source, kind, campaign_name, utm_campaign, keyword")
      .in("customer_id", rows.map((r) => r.id))
      .order("received_at", { ascending: false });
    for (const l of (leads ?? []) as LatestLead[]) if (!latest.has(l.customer_id)) latest.set(l.customer_id, l);
  }
  const serviceLabel = (v: string | null) => ctx.services.find((s) => s.value === v)?.label ?? v ?? "";
  const filtered = Boolean(q || status || source);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every lead and call, one row per customer. Duplicates are merged automatically."
        actions={
          <>
            {isOwner ? (
              <Link href="/leads/import" className={buttonClass("secondary")}>
                Import CSV
              </Link>
            ) : null}
            <Link href="/leads/new" className={buttonClass()}>
              Add lead
            </Link>
          </>
        }
      />

      <form className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name, phone or email" aria-label="Search" className="col-span-2 sm:w-64" />
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="sm:w-40">
          <option value="">All statuses</option>
          {CUSTOMER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={source ?? ""} aria-label="Source" className="sm:w-40">
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonClass("secondary", filtered ? "" : "col-span-2")}>
          Filter
        </button>
        {filtered ? (
          <Link href="/leads" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No leads match these filters."
              description="Try another name, phone number or filter."
              actions={[{ href: "/leads", label: "Clear filters", variant: "secondary" }]}
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="No leads yet"
              description="Leads and calls appear here as soon as your landing pages, ad accounts or imports send them. Duplicates are merged automatically."
              actions={[
                ...(isOwner ? [{ href: "/landing-pages", label: "Create a landing page" }] : []),
                { href: "/leads/new", label: "Add lead", variant: isOwner ? ("secondary" as const) : ("primary" as const) },
                ...(isOwner ? [{ href: "/leads/import", label: "Import CSV", variant: "secondary" as const }] : []),
              ]}
            />
          )
        ) : (
          <>
            {/* Phones: one card per customer. */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => {
                const l = latest.get(r.id);
                return (
                  <li key={r.id}>
                    <Link href={`/leads/${r.id}`} className="block px-4 py-3 active:bg-slate-50">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{r.full_name || formatPhone(r.phone) || r.email}</span>
                          <span className="block truncate text-xs text-slate-500">{[formatPhone(r.phone), r.email].filter(Boolean).join(" · ")}</span>
                        </span>
                        <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        {l ? <SourceBadge source={l.source} call={l.kind === "call"} /> : null}
                        {[serviceLabel(r.service), r.zip].filter(Boolean).join(" · ")}
                        <span className="ml-auto">{r.last_lead_at ? timeAgo(r.last_lead_at, workspace.timezone) : ""}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Service · ZIP</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Leads</th>
                    <th className="px-4 py-3 text-right font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const l = latest.get(r.id);
                    const campaign = l?.campaign_name ?? l?.utm_campaign ?? l?.keyword;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/leads/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                            {r.full_name || formatPhone(r.phone) || r.email}
                          </Link>
                          <div className="text-xs text-slate-500">{[formatPhone(r.phone), r.email].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{[serviceLabel(r.service), r.zip].filter(Boolean).join(" · ") || "-"}</td>
                        <td className="px-4 py-3">
                          {l ? (
                            <>
                              <SourceBadge source={l.source} call={l.kind === "call"} />
                              {campaign ? <div className="mt-0.5 max-w-[220px] truncate text-xs text-slate-500">{campaign}</div> : null}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.lead_count}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{r.last_lead_at ? timeAgo(r.last_lead_at, workspace.timezone) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {count && count > PAGE_SIZE ? (
        <p className="mt-3 text-xs text-slate-500">Showing the {PAGE_SIZE} most recent of {count}. Use search or filters to narrow down.</p>
      ) : null}
    </>
  );
}

function SourceBadge({ source, call }: { source: LeadSource; call: boolean }) {
  return (
    <Badge tone="slate">
      {call ? <Phone size={12} className="mr-1" aria-label="Call" /> : null}
      {SOURCE_LABELS[source]}
    </Badge>
  );
}
