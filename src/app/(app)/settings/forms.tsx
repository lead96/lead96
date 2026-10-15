"use client";

import { type ComponentProps, useActionState, useRef } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useRestoreFields } from "@/components/use-restore-fields";
import { BUSINESS_TYPES, US_STATES, type Registration } from "@/lib/texting/registration";
import { US_TIMEZONES } from "@/lib/timezones";
import { inviteMember, saveTextingRegistration, setAutoCall, updateBusiness } from "./actions";

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

export function AutoCallForm({ on, ready }: { on: boolean; ready: boolean }) {
  const [state, action, pending] = useActionState(setAutoCall, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Button type="submit" variant={on ? "secondary" : "primary"} disabled={pending || !ready}>
        {pending ? "Saving..." : on ? "Turn off automatic calls" : "Turn on automatic calls"}
      </Button>
    </form>
  );
}

export function TextingForm({ values }: { values: Partial<Registration> | null }) {
  const [state, action, pending] = useActionState(saveTextingRegistration, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useRestoreFields(formRef, state?.fields);
  const v = (k: keyof Registration) => values?.[k] ?? "";
  const field = (k: keyof Registration, label: string, props: ComponentProps<"input"> = {}, hint?: string) => (
    <Field label={label} htmlFor={`t_${k}`} hint={hint}>
      <Input id={`t_${k}`} name={k} defaultValue={v(k)} {...props} />
    </Field>
  );

  return (
    <form ref={formRef} action={action} className="space-y-5">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("legal_name", "Legal business name", { required: true }, "Exactly as on your IRS EIN letter.")}
        {field("brand_name", "Name customers know (if different)", {}, "Your DBA, if you have one.")}
        <Field label="Business type" htmlFor="t_business_type">
          <Select id="t_business_type" name="business_type" defaultValue={v("business_type") || "llc"}>
            {Object.entries(BUSINESS_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {field("ein", "EIN (federal tax ID)", { required: true, inputMode: "numeric", placeholder: "12-3456789" })}
        {field("website", "Business website", { required: true, placeholder: "acmehvac.com" })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("street", "Street address", { required: true, autoComplete: "street-address" })}</div>
        {field("city", "City", { required: true })}
        <div className="grid grid-cols-2 gap-4">
          <Field label="State" htmlFor="t_state">
            <Select id="t_state" name="state" defaultValue={v("state")} required>
              <option value="">-</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          {field("zip", "ZIP", { required: true, inputMode: "numeric", maxLength: 5 })}
        </div>
      </div>
      <div>
        <p className="mb-3 text-sm font-medium text-slate-700">Contact person for the carriers</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("contact_first_name", "First name", { required: true })}
          {field("contact_last_name", "Last name", { required: true })}
          {field("contact_title", "Job title", { required: true, placeholder: "Owner" })}
          {field("contact_email", "Email", { required: true, type: "email" })}
          {field("contact_phone", "Phone", { required: true, type: "tel" })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="submit" disabled={pending}>
          {pending ? "Saving..." : "Send to Lead96"}
        </Button>
        <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
          Save for later
        </Button>
      </div>
    </form>
  );
}
