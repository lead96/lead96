import { PhoneCall, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { formatDuration } from "@/lib/intake/call";
import { createClient } from "@/lib/supabase/server";
import type { CallOutcome } from "@/lib/voice/agent-config";
import { OUTCOME_TONES, outcomeLabel, TRIGGER_LABELS } from "@/lib/voice/present";

export const metadata: Metadata = { title: "Calls" };

type Row = {
  id: string;
  direction: "inbound" | "outbound";
  trigger: string;
  status: string;
  outcome: CallOutcome | null;
  needs_review: boolean;
  duration_seconds: number | null;
  summary: string | null;
  created_at: string;
  customer_id: string | null;
  customers: { full_name: string | null; phone: string | null } | null;
};

export default async function CallsPage({ searchParams }: PageProps<"/calls">) {
  const workspace = await requireWorkspace();
  const sp = await searchParams;
  const review = sp.view === "review";
  const supabase = await createClient();

  let q = supabase
    .from("calls")
    .select("id, direction, trigger, status, outcome, needs_review, duration_seconds, summary, created_at, customer_id, customers (full_name, phone)")
    .eq("workspace_id", workspace.id)
    .neq("trigger", "test")
    .order("created_at", { ascending: false })
    .limit(100);
  if (review) q = q.eq("needs_review", true);
  const [{ data }, { count: reviewCount }, { data: voice }] = await Promise.all([
    q,
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("needs_review", true),
    supabase.from("voice_agents").select("auto_call").eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  const calls = (data ?? []) as unknown as Row[];
  const tz = workspace.timezone;

  const tabs = [
    { href: "/calls", label: "All calls", active: !review },
    { href: "/calls?view=review", label: `Needs review${reviewCount ? ` (${reviewCount})` : ""}`, active: review },
  ];

  return (
    <>
      <PageHeader title="Calls" description="Every AI call: who, what happened and what the caller said." />
      <div className="mb-6 flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              t.active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {calls.length === 0 ? (
        <Card>
          <EmptyState
            icon={PhoneCall}
            title={review ? "Nothing to review" : "No AI calls yet"}
            description={
              review
                ? "Calls the AI was unsure about, emergencies and unclear results show up here."
                : voice?.auto_call
                  ? "The AI calls new form leads automatically. Calls appear here as they happen."
                  : "Turn on automatic calls in Settings, or start a call from a customer's page."
            }
            actions={review ? [] : [{ href: "/settings", label: "AI caller settings", variant: "secondary" }]}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {calls.map((c) => {
              const who = c.customers?.full_name || formatPhone(c.customers?.phone ?? null) || "Unknown caller";
              const Icon = c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={c.id}>
                  <Link href={`/calls/${c.id}`} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50" data-call={c.id}>
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Icon size={15} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{who}</span>
                        <Badge tone={c.outcome ? OUTCOME_TONES[c.outcome] : c.status === "error" ? "red" : "slate"}>{outcomeLabel(c.outcome, c.status)}</Badge>
                        {c.needs_review ? <Badge tone="amber">Needs review</Badge> : null}
                      </span>
                      {c.summary ? <span className="mt-1 line-clamp-2 block text-sm text-slate-600">{c.summary}</span> : null}
                      <span className="mt-1 block text-xs text-slate-500">
                        {[formatDateTime(c.created_at, tz), TRIGGER_LABELS[c.trigger] ?? c.trigger, c.duration_seconds ? formatDuration(c.duration_seconds) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
