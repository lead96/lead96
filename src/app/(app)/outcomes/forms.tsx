"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { setAppointmentStatus } from "../calendar/actions";

/** Did the visit happen? One click: done, no-show or it did not take place. */
export function VisitResultButtons({ id }: { id: string }) {
  const [state, action, pending] = useActionState(setAppointmentStatus, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="appointment_id" value={id} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="status" value="completed" size="sm" disabled={pending}>
          Done
        </Button>
        <Button type="submit" name="status" value="no_show" size="sm" variant="secondary" disabled={pending}>
          No-show
        </Button>
        <Button type="submit" name="status" value="cancelled" size="sm" variant="ghost" disabled={pending}>
          Did not happen
        </Button>
      </div>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
