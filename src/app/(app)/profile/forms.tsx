"use client";

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { WEEKDAYS, WEEKDAY_LABELS, formatUsPhone, type AgentQuestion, type BookingHours } from "@/lib/setup/draft";
import type { Option } from "@/lib/setup/prompts";
import { regeneratePlan, saveAgentSettings, saveDemandProfile, type ProfileState } from "./actions";

/**
 * Submit without React's automatic form reset, so a validation error never wipes
 * checkboxes and hours the owner just edited.
 */
function useNoResetAction(action: (s: ProfileState, f: FormData) => Promise<ProfileState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}

function Status({ state }: { state: ProfileState }) {
  if (state?.error) return <Alert tone="error">{state.error}</Alert>;
  if (state?.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function CheckboxGroup({ name, options, selected, legend }: { name: string; options: Option[]; selected: string[]; legend: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="h-4 w-4 accent-brand-600" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type ProfileValues = {
  services: string[];
  lead_types: string[];
  customer_types: string[];
  zip_codes: string[];
  booking_hours: BookingHours;
  capacity_per_day: number | null;
  appointment_minutes: number | null;
  monthly_budget: number | null;
  target_cost_per_appointment: number | null;
  notes: string | null;
};

export function DemandProfileForm({
  values,
  options,
  readOnly,
}: {
  values: ProfileValues;
  options: { services: Option[]; customerTypes: Option[] };
  readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useNoResetAction(saveDemandProfile);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Status state={state} />
      <fieldset disabled={readOnly} className="space-y-5">
        <CheckboxGroup name="services" legend="Services" options={options.services} selected={values.services} />
        <CheckboxGroup
          name="lead_types"
          legend="Leads you want"
          options={[
            { value: "call", label: "Phone calls" },
            { value: "form", label: "Web forms" },
          ]}
          selected={values.lead_types}
        />
        <CheckboxGroup name="customer_types" legend="Customers" options={options.customerTypes} selected={values.customer_types} />

        <Field label="Service area — ZIP codes" htmlFor="zip_codes" hint="Separate with commas, spaces or new lines.">
          <textarea
            id="zip_codes"
            name="zip_codes"
            rows={3}
            defaultValue={values.zip_codes.join(", ")}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Booking hours</legend>
          <div className="space-y-1.5">
            {WEEKDAYS.map((day) => {
              const range = values.booking_hours[day]?.[0];
              return (
                <div key={day} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm sm:grid-cols-[4.5rem_8.5rem_auto_8.5rem] sm:justify-start">
                  <label className="col-span-3 flex items-center gap-2 text-slate-700 sm:col-span-1">
                    <input type="checkbox" name={`hours_${day}_on`} defaultChecked={Boolean(range)} className="h-4 w-4 accent-brand-600" />
                    {WEEKDAY_LABELS[day]}
                  </label>
                  <Input type="time" name={`hours_${day}_start`} defaultValue={range?.start ?? "08:00"} aria-label={`${WEEKDAY_LABELS[day]} start`} />
                  <span className="text-slate-400">to</span>
                  <Input type="time" name={`hours_${day}_end`} defaultValue={range?.end ?? "17:00"} aria-label={`${WEEKDAY_LABELS[day]} end`} />
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jobs you can take per day" htmlFor="capacity_per_day">
            <Input id="capacity_per_day" name="capacity_per_day" type="number" min={1} max={200} defaultValue={values.capacity_per_day ?? ""} />
          </Field>
          <Field label="Appointment length (minutes)" htmlFor="appointment_minutes" hint="Optional. Default 60.">
            <Input id="appointment_minutes" name="appointment_minutes" type="number" min={15} max={480} step={15} defaultValue={values.appointment_minutes ?? ""} />
          </Field>
          <Field label="Monthly ad budget (USD)" htmlFor="monthly_budget">
            <Input id="monthly_budget" name="monthly_budget" inputMode="decimal" defaultValue={values.monthly_budget ?? ""} />
          </Field>
          <Field label="Target cost per booked appointment (USD)" htmlFor="target_cost_per_appointment" hint="Optional.">
            <Input id="target_cost_per_appointment" name="target_cost_per_appointment" inputMode="decimal" defaultValue={values.target_cost_per_appointment ?? ""} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" hint="Optional. Anything the AI should know about your business.">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            maxLength={1000}
            defaultValue={values.notes ?? ""}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
        </Field>
      </fieldset>
      {!readOnly ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </form>
  );
}

const CORE = ["service", "zip_code", "homeowner"];

export function AgentSettingsForm({
  questions,
  transferPhone,
  greeting,
  readOnly,
}: {
  questions: AgentQuestion[];
  transferPhone: string | null;
  greeting: string | null;
  readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useNoResetAction(saveAgentSettings);
  const [rows, setRows] = useState(() => questions.map((q, i) => ({ ...q, id: `${q.key}-${i}` })));

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Status state={state} />
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone for live transfers" htmlFor="transfer_phone" hint="When a caller asks for a person, the AI transfers here.">
            <Input id="transfer_phone" name="transfer_phone" type="tel" defaultValue={formatUsPhone(transferPhone)} />
          </Field>
          <Field label="Greeting" htmlFor="greeting" hint="Optional. How the AI opens a call.">
            <Input id="greeting" name="greeting" maxLength={300} defaultValue={greeting ?? ""} placeholder="Hi, this is the scheduling assistant for …" />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Questions the AI asks every lead</legend>
          <ol className="space-y-2">
            {rows.map((q, i) => {
              const core = CORE.includes(q.key);
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="q_key" value={q.key} />
                  <span className="w-5 text-right text-xs text-slate-400">{i + 1}.</span>
                  <Input
                    name="q_text"
                    defaultValue={q.question}
                    maxLength={200}
                    aria-label={`Question ${i + 1}`}
                    placeholder="e.g. Is the unit on the roof?"
                    className="min-w-0 flex-1"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-600" title={core ? "Needed to qualify a lead" : undefined}>
                    <input
                      type="checkbox"
                      name={`q_required:${i}`}
                      defaultChecked={q.required}
                      disabled={core}
                      className="h-4 w-4 accent-brand-600"
                    />
                    Required
                  </label>
                  {!core && !readOnly ? (
                    <button
                      type="button"
                      onClick={() => setRows((r) => r.filter((x) => x.id !== q.id))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="w-[46px]" />
                  )}
                </li>
              );
            })}
          </ol>
          {!readOnly && rows.length < 20 ? (
            <button
              type="button"
              onClick={() =>
                setRows((r) => [...r, { key: "new", question: "", answer_type: "text", required: false, id: `new-${Date.now()}` }])
              }
              className="mt-2 text-sm font-medium text-brand-600 hover:underline"
            >
              + Add a question
            </button>
          ) : null}
        </fieldset>
      </fieldset>
      {!readOnly ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </form>
  );
}

export function RegeneratePlanButton({ children }: { children: ReactNode }) {
  const [state, dispatch, pending] = useActionState(regeneratePlan, undefined);
  return (
    <div className="space-y-3">
      <Status state={state} />
      <form action={dispatch}>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Creating plan…" : children}
        </Button>
      </form>
    </div>
  );
}
