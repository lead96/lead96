"use client";

import { PhoneCall } from "lucide-react";
import { useActionState } from "react";
import { Alert, Button, Select } from "@/components/ui";
import { callNow, reviewCall } from "./actions";

const OUTCOMES: [string, string][] = [
  ["booked", "Booked"],
  ["qualified", "Qualified"],
  ["callback", "Call back later"],
  ["transferred", "Transferred to team"],
  ["not_interested", "Not interested"],
  ["not_qualified", "Not a fit"],
  ["voicemail", "Voicemail"],
  ["no_answer", "No answer"],
  ["wrong_number", "Wrong number"],
  ["do_not_call", "Asked not to be called"],
  ["other", "Other"],
];

export function ReviewForm({ callId, outcome, needsReview }: { callId: string; outcome: string | null; needsReview: boolean }) {
  const [state, action, pending] = useActionState(reviewCall, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="call_id" value={callId} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="outcome" defaultValue={outcome ?? ""} aria-label="Outcome" className="w-56">
          <option value="">Keep outcome</option>
          {OUTCOMES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant={needsReview ? "primary" : "secondary"} disabled={pending}>
          {pending ? "Saving..." : needsReview ? "Mark reviewed" : "Save"}
        </Button>
      </div>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <p className="text-xs text-emerald-700">{state.message}</p> : null}
    </form>
  );
}

export function CallNowButton({ customerId, blocked }: { customerId: string; blocked: string | null }) {
  const [state, action, pending] = useActionState(callNow, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || Boolean(blocked)}>
        <PhoneCall size={14} aria-hidden />
        {pending ? "Starting..." : "Call now with AI"}
      </Button>
      {blocked ? <p className="text-xs text-slate-500">{blocked}</p> : null}
      {state?.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state?.message ? <p className="text-xs text-emerald-700">{state.message}</p> : null}
    </form>
  );
}
