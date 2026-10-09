"use client";

import { useActionState, useRef } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { useRestoreFields } from "@/components/use-restore-fields";
import { US_TIMEZONES } from "@/lib/timezones";
import { createWorkspace } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createWorkspace, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useRestoreFields(formRef, state?.fields);

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-slate-900">Set up your business</h1>
      <p className="mt-1 text-sm text-slate-500">You can change these later in Settings.</p>
      <form ref={formRef} action={action} className="mt-5 space-y-4">
        {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Field label="Business name" htmlFor="name">
          <Input id="name" name="name" placeholder="e.g. Cool Air HVAC" required />
        </Field>
        <Field label="Time zone" htmlFor="timezone" hint="Used for booking hours and call windows.">
          <Select id="timezone" name="timezone" defaultValue="America/New_York">
            {US_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating..." : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
