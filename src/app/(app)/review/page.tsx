import { ArrowRight, ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, cx, EmptyState, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { money } from "@/lib/leads/outcomes";
import { STATUS_LABELS as CUSTOMER_STATUS } from "@/lib/leads/normalize";
import { REVIEW_KINDS, STATUS_LABELS, type ReviewField, type ReviewKind } from "@/lib/review/items";
import { loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import type { CallOutcome } from "@/lib/voice/agent-config";
import { OUTCOME_LABELS } from "@/lib/voice/calls";
import { ReviewItemForm } from "./forms";

export const metadata: Metadata = { title: "Review" };

type Item = {
  id: string;
  kind: ReviewKind;
  field: ReviewField;
  call_id: string | null;
  customer_id: string | null;
  ai_value: string | null;
  detail: { confidence?: number; summary?: string; call_id?: string; result?: string; reason?: string; average?: number };
  status: keyof typeof STATUS_LABELS;
  before: Record<string, string | number | null> | null;
  after: Record<string, string | number | null> | null;
  reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
};

const VIEWS = { open: "To review", unsure: "Not sure", done: "Done" } as const;
type View = keyof typeof VIEWS;

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const workspace = await requireWorkspace();
  const sp = await searchParams;
  const view: View = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as View) : "open";
  const supabase = await createClient();

  let q = supabase
    .from("review_items")
    .select("*, customers (full_name, phone)")
    .eq("workspace_id", workspace.id)
    .order(view === "done" ? "reviewed_at" : "created_at", { ascending: false })
    .limit(view === "done" ? 50 : 100);
  q = view === "done" ? q.in("status", ["approved", "corrected", "rejected"]) : q.eq("status", view);
  const [{ data }, ctx, { data: counts }] = await Promise.all([
    q,
    loadSetupContext(supabase, workspace),
    supabase.from("review_items").select("status").eq("workspace_id", workspace.id).in("status", ["open", "unsure"]),
  ]);
  const items = (data ?? []) as unknown as Item[];
  const count = (s: string) => (counts ?? []).filter((c) => c.status === s).length;

  const reviewerIds = [...new Set(items.map((i) => i.reviewed_by).filter(Boolean))] as string[];
  const { data: people } = reviewerIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", reviewerIds) : { data: [] };
  const who = (id: string | null) => {
    const p = (people ?? []).find((x) => x.id === id);
    return p ? p.full_name || p.email : id ? "a team member" : "Lead96";
  };

  const tz = workspace.timezone;
  const serviceLabel = (v: string | null | undefined) => (v ? (ctx.services.find((s) => s.value === v)?.label ?? v) : "-");
  const show = (field: ReviewField, v: string | number | null | undefined) =>
    v === null || v === undefined || v === ""
      ? "-"
      : field === "call_outcome"
        ? (OUTCOME_LABELS[v as CallOutcome] ?? String(v))
        : field === "service"
          ? v === "unknown"
            ? "Unknown"
            : serviceLabel(String(v))
          : money(v);
  const outcomeOptions = Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label }));
  const serviceOptions = ctx.services.map((s) => ({ value: s.value, label: s.label }));

  return (
    <>
      <PageHeader
        title="Review"
        description="Calls and results worth a second look. Your answers correct the record and teach the AI what good looks like."
      />

      <nav aria-label="Review views" className="mb-6 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={v === "open" ? "/review" : `/review?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={cx("rounded-md px-2.5 py-1 text-sm", v === view ? "bg-white font-medium text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900")}
          >
            {VIEWS[v]}
            {v !== "done" && count(v) ? ` (${count(v)})` : ""}
          </Link>
        ))}
      </nav>

      {!items.length ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title={view === "done" ? "Nothing reviewed yet" : view === "unsure" ? "Nothing set aside" : "Nothing to review"}
            description={
              view === "open"
                ? "Items show up here when the AI was unsure, a call went wrong, or a result does not match what the AI concluded."
                : undefined
            }
          />
        </Card>
      ) : (
        <ul className="space-y-4">
          {items.map((i) => {
            const k = REVIEW_KINDS[i.kind];
            const callId = i.call_id ?? i.detail.call_id ?? null;
            const name = i.customers?.full_name || formatPhone(i.customers?.phone) || "Unknown caller";
            return (
              <li key={i.id}>
                <Card className="p-5 sm:p-6">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={i.kind === "emergency" || i.kind === "call_error" ? "red" : i.kind === "high_value" ? "green" : "amber"}>{k.label}</Badge>
                        {i.customer_id ? (
                          <Link href={`/leads/${i.customer_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                            {name}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">{name}</span>
                        )}
                        <span className="text-xs text-slate-500">{formatDateTime(i.created_at, tz)}</span>
                      </div>
                      <p className="text-sm text-slate-600">{k.explain}</p>
                      <dl className="space-y-1 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-slate-500">{i.field === "revenue" ? "Revenue" : i.field === "service" ? "AI heard" : "AI said"}</dt>
                          <dd className="text-slate-900">
                            {show(i.field, i.ai_value)}
                            {i.detail.confidence !== undefined ? <span className="text-slate-500"> · {Math.round(i.detail.confidence * 100)}% sure</span> : null}
                          </dd>
                        </div>
                        {i.kind === "disagreement" && i.detail.result ? (
                          <div className="flex gap-2">
                            <dt className="w-28 shrink-0 text-slate-500">Real result</dt>
                            <dd className="text-slate-900">
                              {CUSTOMER_STATUS[i.detail.result as keyof typeof CUSTOMER_STATUS] ?? i.detail.result}
                            </dd>
                          </div>
                        ) : null}
                        {i.kind === "high_value" && i.detail.average ? (
                          <div className="flex gap-2">
                            <dt className="w-28 shrink-0 text-slate-500">Usual job</dt>
                            <dd className="text-slate-900">{money(i.detail.average)} on average</dd>
                          </div>
                        ) : null}
                      </dl>
                      {i.detail.summary ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{i.detail.summary}</p> : null}
                      {callId ? (
                        <Link href={`/calls/${callId}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">
                          Listen to the call
                        </Link>
                      ) : null}
                    </div>

                    <div>
                      {view === "done" ? (
                        <div className="space-y-1.5 text-sm">
                          <Badge tone={i.status === "corrected" ? "blue" : i.status === "approved" ? "green" : "slate"}>{STATUS_LABELS[i.status]}</Badge>
                          {i.after ? (
                            <p className="flex flex-wrap items-center gap-1.5 text-slate-900">
                              {show(i.field, Object.values(i.before ?? {})[0])}
                              <ArrowRight size={14} className="text-slate-400" aria-label="changed to" />
                              {show(i.field, Object.values(i.after)[0])}
                            </p>
                          ) : null}
                          {i.reason ? <p className="text-slate-600">{i.reason}</p> : null}
                          <p className="text-xs text-slate-500">
                            by {who(i.reviewed_by)}
                            {i.reviewed_at ? `, ${formatDateTime(i.reviewed_at, tz)}` : ""}
                          </p>
                        </div>
                      ) : (
                        <ReviewItemForm
                          key={i.status}
                          id={i.id}
                          field={i.field}
                          options={i.field === "service" ? serviceOptions : outcomeOptions}
                          unsure={i.status === "unsure"}
                        />
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
