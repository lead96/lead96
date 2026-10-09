"use client";

import { useActionState, useRef } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useRestoreFields } from "@/components/use-restore-fields";
import type { Option } from "@/lib/setup/prompts";
import { addManualLead } from "../actions";

export function ManualLeadForm({ services }: { services: Option[] }) {
  const [state, action, pending] = useActionState(addManualLead, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useRestoreFields(formRef, state?.fields);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="phone" hint="Phone or email is required.">
          <Input id="phone" name="phone" type="tel" autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service" htmlFor="service">
          <Select id="service" name="service" defaultValue="">
            <option value="">-</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ZIP code" htmlFor="zip">
          <Input id="zip" name="zip" inputMode="numeric" maxLength={10} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="message">
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={2000}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add lead"}
      </Button>
    </form>
  );
}
