"use client";

import { useActionState, useRef } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useRestoreFields } from "@/components/use-restore-fields";
import { US_TIMEZONES } from "@/lib/timezones";
import { inviteMember, updateBusiness } from "./actions";

export function BusinessForm({
  business,
  disabled,
}: {
  business: { name: string; timezone: string; phone: string | null; website: string | null };
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateBusiness, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useRestoreFields(formRef, state?.fields);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Business name" htmlFor="name">
          <Input id="name" name="name" defaultValue={business.name} required />
        </Field>
        <Field label="Time zone" htmlFor="timezone">
          <Select id="timezone" name="timezone" defaultValue={business.timezone}>
            {US_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Business phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={business.phone ?? ""} />
        </Field>
        <Field label="Website" htmlFor="website">
          <Input id="website" name="website" defaultValue={business.website ?? ""} placeholder="https://" />
        </Field>
      </fieldset>
      {!disabled ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      ) : null}
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useRestoreFields(formRef, state?.fields);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Invite a team member</p>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? (
        <Alert tone="success">
          {state.message}
          {state.inviteUrl ? <span className="mt-1 block break-all font-mono text-xs">{state.inviteUrl}</span> : null}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="email" type="email" placeholder="name@company.com" required aria-label="Email" />
        <Select name="role" defaultValue="staff" className="sm:w-32" aria-label="Role">
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </Select>
        <Button type="submit" disabled={pending} className="shrink-0">
          Invite
        </Button>
      </div>
    </form>
  );
}
