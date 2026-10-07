"use client";

import { useActionState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { CUSTOMER_STATUSES, STATUS_LABELS, type CustomerStatus } from "@/lib/leads/normalize";
import { changeStatus, saveNotes } from "../actions";

export function StatusForm({ customerId, status }: { customerId: string; status: CustomerStatus }) {
  const [state, action, pending] = useActionState(changeStatus, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <label htmlFor="status" className="block text-sm font-medium text-slate-700">
        Change status
      </label>
      <div className="flex gap-2">
        <Select id="status" name="status" defaultValue={status} key={status} className="flex-1">
          {CUSTOMER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "Update"}
        </Button>
      </div>
      <Input name="reason" placeholder="Reason (optional), e.g. “left voicemail”" maxLength={300} aria-label="Reason" />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
    </form>
  );
}

export function NotesForm({ customerId, notes }: { customerId: string; notes: string }) {
  const [state, action, pending] = useActionState(saveNotes, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <textarea
        name="notes"
        defaultValue={notes}
        key={notes}
        rows={4}
        maxLength={5000}
        aria-label="Notes"
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {state?.error ? <span className="text-sm text-red-600">{state.error}</span> : null}
        {state?.message ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
      </div>
    </form>
  );
}
