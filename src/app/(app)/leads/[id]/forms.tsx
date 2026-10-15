"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { CUSTOMER_STATUSES, STATUS_LABELS, type CustomerStatus } from "@/lib/leads/normalize";
import { outcomeNeeds } from "@/lib/leads/outcomes";
import { changeStatus, saveNotes } from "../actions";

export function StatusForm({
  customerId,
  status,
  reasonCode,
  amount,
  compact = false,
}: {
  customerId: string;
  status: CustomerStatus;
  reasonCode?: string | null;
  amount?: number | null;
  compact?: boolean;
}) {
  // Controlled: the reason and amount fields follow the chosen status.
  const [value, setValue] = useState<CustomerStatus>(status);
  const [reason, setReason] = useState(reasonCode ?? "");
  const [sum, setSum] = useState(amount ? String(amount) : "");
  const [note, setNote] = useState("");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof changeStatus>>, fd: FormData) => {
    const r = await changeStatus(prev, fd);
    if (r?.message) setNote("");
    return r;
  }, undefined);
  const needs = outcomeNeeds(value);
  const id = (k: string) => `${k}-${customerId}`;
  return (
    <form
      // Submitted by hand (not via the action prop) so React doesn't reset the form: after a refused
      // save the dropdowns must still show what was chosen.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-2"
    >
      <input type="hidden" name="customer_id" value={customerId} />
      {compact ? null : (
        <label htmlFor={id("status")} className="block text-sm font-medium text-slate-700">
          Status and result
        </label>
      )}
      <div className="flex gap-2">
        <Select
          id={id("status")}
          name="status"
          value={value}
          onChange={(e) => {
            setValue(e.target.value as CustomerStatus);
            setReason("");
          }}
          className="flex-1"
          aria-label="Status"
        >
          {CUSTOMER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "..." : "Save"}
        </Button>
      </div>
      {needs.reason ? (
        <Select name="reason_code" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" required>
          <option value="">{value === "lost" ? "Why was it lost?" : "Why not qualified?"}</option>
          {Object.entries(needs.reason).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      ) : null}
      {needs.amount ? (
        <Input
          name="amount"
          value={sum}
          onChange={(e) => setSum(e.target.value)}
          inputMode="decimal"
          placeholder={needs.amount === "revenue" ? "Revenue in $, e.g. 4500" : "Estimate in $, e.g. 4500"}
          aria-label={needs.amount === "revenue" ? "Revenue" : "Estimate"}
          required
        />
      ) : null}
      <Input name="reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. 'went with a cheaper quote'" maxLength={300} aria-label="Note" />
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
          {pending ? "Saving..." : "Save notes"}
        </Button>
        {state?.error ? <span className="text-sm text-red-600">{state.error}</span> : null}
        {state?.message ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
      </div>
    </form>
  );
}
