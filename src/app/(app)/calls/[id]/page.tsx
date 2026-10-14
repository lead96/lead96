import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { formatDuration } from "@/lib/intake/call";
import type { AgentQuestion } from "@/lib/setup/draft";
import { loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";
import type { CallOutcome } from "@/lib/voice/agent-config";
import { OUTCOME_LABELS } from "@/lib/voice/calls";
import { callAnswers, OUTCOME_TONES, outcomeLabel, TRIGGER_LABELS } from "@/lib/voice/present";
import { ReviewForm } from "../forms";

export const metadata: Metadata = { title: "Call" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CallPage({ params }: PageProps<"/calls/[id]">) {
  const workspace = await requireWorkspace();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const { data: call } = await supabase.from("calls").select("*").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!call) notFound();
  const [{ data: customer }, { data: agent }, ctx, recording, reviewer] = await Promise.all([
    call.customer_id ? supabase.from("customers").select("id, full_name, phone").eq("id", call.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("agent_settings").select("questions").eq("workspace_id", workspace.id).maybeSingle(),
    loadSetupContext(supabase, workspace),
    call.recording_path ? supabase.storage.from("call-recordings").createSignedUrl(call.recording_path, 3600) : Promise.resolve({ data: null }),
    call.reviewed_by ? supabase.from("profiles").select("full_name, email").eq("id", call.reviewed_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const tz = workspace.timezone;
  const who = customer?.full_name || formatPhone(customer?.phone ?? (call.direction === "inbound" ? call.from_number : call.to_number)) || (call.trigger === "test" ? "browser test" : "Unknown caller");
  const serviceLabel = (v: string) => ctx.services.find((s) => s.value === v)?.label ?? v;
  const answers = callAnswers((call.analysis ?? {}) as Record<string, unknown>, ((agent?.questions ?? []) as AgentQuestion[]).filter((q) => q?.question), serviceLabel);
  const transcript = (call.transcript ?? []) as { role: "agent" | "user"; content: string }[];
  const outcome = call.outcome as CallOutcome | null;

  return (
    <>
      <PageHeader
        title={`Call with ${who}`}
        description={[formatDateTime(call.created_at, tz), TRIGGER_LABELS[call.trigger] ?? call.trigger, call.duration_seconds ? formatDuration(call.duration_seconds) : null]
          .filter(Boolean)
          .join(" · ")}
        back={{ href: "/calls", label: "Calls" }}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-6 lg:space-y-8">
          <Card className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={outcome ? OUTCOME_TONES[outcome] : call.status === "error" ? "red" : "slate"}>{outcomeLabel(outcome, call.status)}</Badge>
              {call.needs_review ? <Badge tone="amber">Needs review</Badge> : null}
              {call.confidence !== null ? <span className="text-xs text-slate-500">AI confidence {Math.round(Number(call.confidence) * 100)}%</span> : null}
            </div>
            {call.summary ? <p className="text-sm leading-relaxed text-slate-700">{call.summary}</p> : null}
            {call.appointment ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Visit requested: <span className="font-medium">{(call.appointment as { label: string }).label}</span>
                {(call.appointment as { address?: string }).address ? ` · ${(call.appointment as { address?: string }).address}` : ""}
              </p>
            ) : null}
            {call.error ? <p className="text-sm text-red-600">{call.error}</p> : null}
            {customer ? (
              <Link href={`/leads/${customer.id}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">
                Open customer
              </Link>
            ) : null}
            {recording.data?.signedUrl ? (
              <audio controls preload="none" src={recording.data.signedUrl} className="w-full">
                <track kind="captions" />
              </audio>
            ) : call.status === "ended" ? (
              <p className="text-xs text-slate-500">No recording stored for this call.</p>
            ) : null}
          </Card>

          {answers.length ? (
            <Card className="p-6">
              <h2 className="mb-3 font-semibold text-slate-900">What the AI found out</h2>
              <dl className="space-y-2.5 text-sm">
                {answers.map((a) => (
                  <div key={a.label}>
                    <dt className="text-slate-500">{a.label}</dt>
                    <dd className="text-slate-900">{a.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          <Card className="space-y-3 p-6">
            <h2 className="font-semibold text-slate-900">Review</h2>
            <p className="text-sm text-slate-500">
              {call.reviewed_at
                ? `Reviewed ${formatDateTime(call.reviewed_at, tz)}${reviewer.data ? ` by ${reviewer.data.full_name || reviewer.data.email}` : ""}.`
                : "Correct the outcome if the AI got it wrong, then mark the call as reviewed."}
              {call.original_outcome ? ` The AI said: ${OUTCOME_LABELS[call.original_outcome as CallOutcome] ?? call.original_outcome}.` : ""}
            </p>
            <ReviewForm callId={call.id} outcome={outcome} needsReview={call.needs_review} />
          </Card>
        </div>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Transcript</h2>
          {transcript.length ? (
            <div className="space-y-2.5">
              {transcript.map((t, i) => (
                <div key={i} className={cx("flex", t.role === "user" && "justify-end")}>
                  <p
                    className={cx(
                      "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                      t.role === "agent" ? "rounded-tl-sm bg-slate-100 text-slate-800" : "rounded-tr-sm bg-brand-600 text-white",
                    )}
                  >
                    {t.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{call.status === "ended" ? "No conversation (not answered or voicemail)." : "The transcript appears when the call ends."}</p>
          )}
          <p className="mt-6 text-xs text-slate-400">
            {call.direction === "inbound" ? "Incoming" : "Outgoing"} · from {formatPhone(call.from_number) || "-"} to {formatPhone(call.to_number) || "-"}
            {call.attempt > 1 ? ` · attempt ${call.attempt}` : ""}
          </p>
        </Card>
      </div>
    </>
  );
}
