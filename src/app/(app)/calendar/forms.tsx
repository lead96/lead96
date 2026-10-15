"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { addBlackout, bookVisit, moveAppointment, setAppointmentStatus } from "./actions";

export type WindowOption = { value: string; label: string };

function Note({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <p className="text-xs text-red-600">{state.error}</p>;
  if (state?.message) return <p className="text-xs text-emerald-700">{state.message}</p>;
  return null;
}

/** Status buttons and "move to another window" for one visit. */
export function AppointmentActions({ id, status, windows }: { id: string; status: string; windows: WindowOption[] }) {
  const [statusState, statusAction, statusPending] = useActionState(setAppointmentStatus, undefined);
  const [moveState, moveAction, movePending] = useActionState(moveAppointment, undefined);
  const [moving, setMoving] = useState(false);
  const open = status === "scheduled" || status === "confirmed";
  const button = (value: string, label: string, variant: "primary" | "secondary" | "ghost" = "secondary") => (
    <Button type="submit" name="status" value={value} size="sm" variant={variant} disabled={statusPending}>
      {label}
    </Button>
  );
  return (
    <div className="space-y-2">
      <form action={statusAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="appointment_id" value={id} />
        {status === "scheduled" ? button("confirmed", "Confirm", "primary") : null}
        {open ? button("completed", "Done") : null}
        {open ? button("no_show", "No-show") : null}
        {open ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setMoving((m) => !m)}>
            Move
          </Button>
        ) : null}
        {open ? button("cancelled", "Cancel", "ghost") : null}
        {!open ? button("scheduled", "Reopen", "ghost") : null}
      </form>
      <Note state={statusState} />
      {moving && open ? (
        <form action={moveAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="appointment_id" value={id} />
          <Select name="window" defaultValue="" aria-label="New window" className="w-64">
            <option value="" disabled>
              {windows.length ? "Pick a new window" : "No open windows"}
            </option>
            {windows.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={movePending || !windows.length}>
            {movePending ? "Moving..." : "Move visit"}
          </Button>
        </form>
      ) : null}
      <Note state={moveState} />
    </div>
  );
}

export function BlackoutForm() {
  const [state, action, pending] = useActionState(addBlackout, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <label className="space-y-1 text-xs text-slate-500">
          From
          <Input type="date" name="starts_on" required />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          To (optional)
          <Input type="date" name="ends_on" />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          Reason (optional)
          <Input name="reason" maxLength={120} placeholder="e.g. Thanksgiving" />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending} className="justify-self-start">
          {pending ? "Saving..." : "Block days"}
        </Button>
      </div>
    </form>
  );
}

/** On the customer page: the team books a visit in an open window. */
export function BookVisitForm({ customerId, windows }: { customerId: string; windows: WindowOption[] }) {
  const [state, action, pending] = useActionState(bookVisit, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <Select name="window" defaultValue="" aria-label="Visit window">
        <option value="" disabled>
          {windows.length ? "Pick a visit window" : "No open windows in the next days"}
        </option>
        {windows.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <Input name="address" maxLength={300} placeholder="Service address (optional)" aria-label="Service address" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || !windows.length}>
        {pending ? "Booking..." : "Book visit"}
      </Button>
      <Note state={state} />
    </form>
  );
}
