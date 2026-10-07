"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card } from "@/components/ui";
import { REQUIRED_FIELDS, describeHours, formatUsPhone, type SetupDraft } from "@/lib/setup/draft";
import type { Option } from "@/lib/setup/prompts";
import { finishSetup, restartSetup, sendSetupMessage, type ChatState } from "./actions";

const LEAD_TYPE_LABELS: Record<string, string> = { form: "Web forms", call: "Phone calls" };

function labelsFor(values: string[], options: Option[]) {
  return values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
}

function fieldValue(key: string, d: SetupDraft, o: { services: Option[]; customerTypes: Option[] }) {
  switch (key) {
    case "services": return labelsFor(d.services, o.services);
    case "lead_types": return d.lead_types.map((t) => LEAD_TYPE_LABELS[t]).join(" + ");
    case "customer_types": return labelsFor(d.customer_types, o.customerTypes);
    case "zip_codes": return d.zip_codes.length > 6 ? `${d.zip_codes.slice(0, 6).join(", ")} +${d.zip_codes.length - 6} more` : d.zip_codes.join(", ");
    case "booking_hours": return describeHours(d.booking_hours);
    case "capacity_per_day": return d.capacity_per_day === null ? "" : `${d.capacity_per_day} per day`;
    case "monthly_budget": return d.monthly_budget === null ? "" : `$${d.monthly_budget.toLocaleString("en-US")} / month`;
    case "transfer_phone": return formatUsPhone(d.transfer_phone);
    case "questions_confirmed":
      return d.questions_confirmed ? (d.extra_questions.length ? `Defaults + ${d.extra_questions.length} of yours` : "Default questions") : "";
    default: return "";
  }
}

export function SetupChat({
  initial,
  options,
  defaultQuestions,
  suggestion,
  hasConversation,
}: {
  initial: ChatState;
  options: { services: Option[]; customerTypes: Option[] };
  defaultQuestions: string[];
  suggestion: string;
  hasConversation: boolean;
}) {
  const [state, action, pending] = useActionState(sendSetupMessage, initial);
  const [input, setInput] = useState(suggestion);
  const [sent, setSent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // After an error, give the owner back what they typed (adjusting state during render, not in an effect).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.unsent) setInput(state.unsent);
  }
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.messages.length, pending]);

  const done = state.missing.length === 0;
  const started = hasConversation || state.messages.length > 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="flex min-h-[480px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {state.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-lg px-3.5 py-2.5 text-sm ${
                  m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                {m.content}
              </p>
            </div>
          ))}
          {pending ? (
            <>
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-lg bg-brand-600/70 px-3.5 py-2.5 text-sm text-white">{sent}</p>
              </div>
              <p className="text-sm text-slate-400">Assistant is typing…</p>
            </>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-200 p-3 sm:p-4">
          {state.error ? (
            <div className="mb-3">
              <Alert tone="error">{state.error}</Alert>
            </div>
          ) : null}
          <form
            ref={formRef}
            action={action}
            onSubmit={() => {
              setSent(input.trim());
              setInput("");
            }}
            className="flex gap-2"
          >
            <textarea
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (input.trim() && !pending) formRef.current?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={800}
              placeholder={done ? "Anything else to change? Or press Save setup." : "Type your answer…"}
              aria-label="Your message"
              className="block min-h-[44px] w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
            <Button type="submit" disabled={pending || !input.trim()} className="self-end">
              Send
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span className="flex gap-3">
              <Link href="/profile" className="hover:underline">
                Prefer a form?
              </Link>
              {started ? (
                <form action={restartSetup}>
                  <button type="submit" className="hover:underline">
                    Start over
                  </button>
                </form>
              ) : null}
            </span>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Your setup</h2>
          <ul className="mt-3 space-y-2.5">
            {REQUIRED_FIELDS.map((f) => {
              const value = fieldValue(f.key, state.draft, options);
              return (
                <li key={f.key} className="flex gap-2 text-sm">
                  <span aria-hidden className={value ? "text-brand-600" : "text-slate-300"}>
                    {value ? "✓" : "○"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-slate-500">{f.label}</span>
                    {value ? <span className="block break-words font-medium text-slate-900">{value}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {state.draft.extra_questions.length > 0 ? (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Your extra call questions</p>
              <ul className="mt-1 list-disc pl-4">
                {state.draft.extra_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {done ? (
          <Card className="border-brand-200 bg-brand-50 p-5">
            <p className="text-sm font-medium text-brand-900">Everything we need is here.</p>
            <p className="mt-1 text-sm text-brand-900/80">Saving also creates your suggested campaign plan. You can edit everything later.</p>
            <form action={finishSetup} className="mt-4">
              <SaveButton />
            </form>
          </Card>
        ) : (
          <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Questions our AI asks callers</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {defaultQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving and creating your plan…" : "Save setup"}
    </Button>
  );
}
