import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { CALL_FIELD_KEYS, formatDuration } from "@/lib/intake/call";
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, type CustomerStatus, type LeadSource } from "@/lib/leads/normalize";
import { loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import { NotesForm, StatusForm } from "./forms";

export const metadata: Metadata = { title: "Customer" };

type Lead = {
  id: string;
  kind: "form" | "call";
  source: LeadSource;
  landing_page_id: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  adset_name: string | null;
  ad_name: string | null;
  keyword: string | null;
  form_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  page_url: string | null;
  service: string | null;
  message: string | null;
  fields: Record<string, unknown>;
  consent_given: boolean;
  attribution_complete: boolean;
  received_at: string;
};
type Event = { id: number; type: string; subject_id: string | null; payload: Record<string, unknown>; actor_id: string | null; created_at: string };

const CALL_STATUS_LABELS: Record<string, string> = {
  completed: "Answered",
  missed: "Missed",
  voicemail: "Voicemail",
  busy: "Busy",
  failed: "Failed",
};
const ANSWERED_BY: Record<string, string> = { ai: "by AI agent", human: "by your team", voicemail: "by voicemail" };
const callKeys = new Set<string>(CALL_FIELD_KEYS);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params }: PageProps<"/leads/[id]">) {
  const workspace = await requireWorkspace();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: customer }, { data: leadRows }, { data: eventRows }, ctx] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("leads").select("*").eq("customer_id", id).order("received_at", { ascending: false }),
    supabase.from("events").select("id, type, subject_id, payload, actor_id, created_at").eq("customer_id", id)
      // Events from one transaction share a timestamp; the id keeps them in the order they happened.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
    loadSetupContext(supabase, workspace),
  ]);
  if (!customer) notFound();
  const leads = (leadRows ?? []) as Lead[];
  const events = (eventRows ?? []) as Event[];

  // Names for people and landing pages mentioned in the timeline.
  const actorIds = [...new Set(events.map((e) => e.actor_id).filter(Boolean))] as string[];
  const pageIds = [...new Set(leads.map((l) => l.landing_page_id).filter(Boolean))] as string[];
  const [{ data: actors }, { data: pages }] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] }),
    pageIds.length ? supabase.from("landing_pages").select("id, name").in("id", pageIds) : Promise.resolve({ data: [] }),
  ]);
  const actorName = (uid: string | null) => {
    const a = (actors ?? []).find((x) => x.id === uid);
    return a ? a.full_name || a.email : null;
  };
  const pageName = (pid: string | null) => (pages ?? []).find((p) => p.id === pid)?.name ?? null;
  const serviceLabel = (v: string | null | undefined) => ctx.services.find((s) => s.value === v)?.label ?? v ?? null;
  const leadById = new Map(leads.map((l) => [l.id, l]));
  // A lead is shown at the time it happened (call start, date in an imported file), not when it was stored.
  const at = (e: Event) => (e.type === "lead.received" && e.subject_id && leadById.get(e.subject_id)?.received_at) || e.created_at;
  const timeline = [...events].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)) || b.id - a.id);
  const latest = leads[0];
  const title = customer.full_name || formatPhone(customer.phone) || customer.email;
  const tz = workspace.timezone;

  const describe = (e: Event): { title: string; detail?: string } => {
    const p = e.payload as Record<string, string | undefined>;
    switch (e.type) {
      case "lead.received": {
        const l = e.subject_id ? leadById.get(e.subject_id) : undefined;
        const src = SOURCE_LABELS[(p.source as LeadSource) ?? "manual"] ?? p.source;
        const what = (l?.kind ?? p.kind) === "call" ? "Call" : "Lead";
        const via = l?.landing_page_id ? pageName(l.landing_page_id) : l?.source === "csv" ? l.form_name : null;
        const f = (l?.fields ?? {}) as Record<string, string | number | undefined>;
        const call =
          l?.kind === "call"
            ? [
                [CALL_STATUS_LABELS[String(f.call_status)] ?? null, ANSWERED_BY[String(f.answered_by)] ?? null].filter(Boolean).join(" "),
                Number(f.duration_seconds) > 0 ? formatDuration(Number(f.duration_seconds)) : null,
              ]
            : [];
        return {
          title: `${what} received — ${src}${via ? ` (${via})` : ""}`,
          detail: [...call, serviceLabel(l?.service ?? p.service), l?.campaign_name ?? p.campaign, l?.ad_name, l?.keyword ? `“${l.keyword}”` : null]
            .filter(Boolean)
            .join(" · "),
        };
      }
      case "customer.created":
        return { title: "Customer created" };
      case "customer.status_changed":
        return {
          title: `Status: ${STATUS_LABELS[p.from as CustomerStatus] ?? p.from} → ${STATUS_LABELS[p.to as CustomerStatus] ?? p.to}`,
          detail: [p.reason, actorName(e.actor_id) ? `by ${actorName(e.actor_id)}` : null].filter(Boolean).join(" · "),
        };
      case "customer.notes_updated":
        return { title: "Notes updated", detail: actorName(e.actor_id) ? `by ${actorName(e.actor_id)}` : undefined };
      case "customer.possible_duplicate":
        return { title: "Possible duplicate", detail: "This phone and email belong to two different customers. Check before merging." };
      default:
        return { title: e.type };
    }
  };

  return (
    <>
      <PageHeader
        title={title ?? "Customer"}
        description={[serviceLabel(customer.service), customer.zip].filter(Boolean).join(" · ") || undefined}
        back={{ href: "/leads", label: "Leads" }}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-6 lg:space-y-8">
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Contact</h2>
              <Badge tone={STATUS_TONES[customer.status as CustomerStatus]}>{STATUS_LABELS[customer.status as CustomerStatus]}</Badge>
            </div>
            <dl className="space-y-2 text-sm">
              <Row label="Phone">{customer.phone ? <a href={`tel:${customer.phone}`} className="text-brand-700 hover:underline">{formatPhone(customer.phone)}</a> : "—"}</Row>
              <Row label="Email">{customer.email ? <a href={`mailto:${customer.email}`} className="break-all text-brand-700 hover:underline">{customer.email}</a> : "—"}</Row>
              <Row label="ZIP">{customer.zip ?? "—"}</Row>
              <Row label="Service">{serviceLabel(customer.service) ?? "—"}</Row>
              <Row label="First source">{customer.first_source ? SOURCE_LABELS[customer.first_source as LeadSource] : "—"}</Row>
              <Row label="Leads">{customer.lead_count}</Row>
              <Row label="First contact">{customer.first_lead_at ? formatDateTime(customer.first_lead_at, tz) : "—"}</Row>
            </dl>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <StatusForm customerId={customer.id} status={customer.status as CustomerStatus} />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold text-slate-900">Notes</h2>
            <NotesForm customerId={customer.id} notes={customer.notes ?? ""} />
          </Card>

          {latest ? (
            <Card className="p-6">
              <h2 className="mb-3 font-semibold text-slate-900">Latest source</h2>
              {!latest.attribution_complete ? (
                <div className="mb-3">
                  <Alert tone="info">Source data incomplete — no campaign or click ID came with this lead.</Alert>
                </div>
              ) : null}
              <dl className="space-y-2 text-sm">
                <Row label="Source">{SOURCE_LABELS[latest.source]}</Row>
                {latest.landing_page_id ? <Row label="Landing page">{pageName(latest.landing_page_id) ?? "—"}</Row> : null}
                {latest.campaign_name || latest.utm_campaign ? <Row label="Campaign">{latest.campaign_name ?? latest.utm_campaign}</Row> : null}
                {latest.adset_name ? <Row label={latest.source === "google" ? "Ad group" : "Ad set"}>{latest.adset_name}</Row> : null}
                {latest.ad_name ? <Row label="Ad">{latest.ad_name}</Row> : null}
                {latest.keyword || latest.utm_term ? <Row label="Keyword">{latest.keyword ?? latest.utm_term}</Row> : null}
                {latest.form_name ? <Row label={latest.source === "csv" ? "File" : "Form"}>{latest.form_name}</Row> : null}
                {latest.utm_source ? <Row label="UTM">{[latest.utm_source, latest.utm_medium].filter(Boolean).join(" / ")}</Row> : null}
                {latest.gclid ? <Row label="Google click">{<span className="break-all font-mono text-xs">{latest.gclid}</span>}</Row> : null}
                {latest.fbclid ? <Row label="Meta click">{<span className="break-all font-mono text-xs">{latest.fbclid}</span>}</Row> : null}
                <Row label="Consent">{latest.consent_given ? "Given" : "Not recorded"}</Row>
              </dl>
            </Card>
          ) : null}
        </div>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Timeline</h2>
          <ol className="relative space-y-5 border-l border-slate-200 pl-5">
            {timeline.map((e) => {
              const d = describe(e);
              const lead = e.type === "lead.received" && e.subject_id ? leadById.get(e.subject_id) : undefined;
              const answers = lead ? Object.entries(lead.fields ?? {}).filter(([k, v]) => v !== null && v !== "" && !(lead.kind === "call" && callKeys.has(k))) : [];
              const recording = lead?.kind === "call" ? lead.fields?.recording_url : undefined;
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" aria-hidden />
                  <p className="text-xs text-slate-500">{formatDateTime(at(e), tz)}</p>
                  <p className="text-sm font-medium text-slate-900">{d.title}</p>
                  {d.detail ? <p className="text-sm text-slate-600">{d.detail}</p> : null}
                  {lead?.message ? <p className="mt-1 whitespace-pre-line rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{lead.message}</p> : null}
                  {typeof recording === "string" && /^https:\/\//.test(recording) ? (
                    <a href={recording} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                      Call recording ↗
                    </a>
                  ) : null}
                  {answers.length ? (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer text-xs text-brand-700">
                        {lead?.kind === "call" ? "Caller answers" : lead?.source === "csv" ? "Other columns" : "Form answers"} ({answers.length})
                      </summary>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-slate-50 px-3 py-2 text-xs">
                        {answers.map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-slate-500">{k.replaceAll("_", " ")}</dt>
                            <dd className="break-words text-slate-800">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-900">{children}</dd>
    </div>
  );
}
