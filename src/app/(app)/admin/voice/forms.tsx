"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { assignNumberAction, buyNumberAction } from "./actions";

type Business = { id: string; name: string };

export function BuyNumberForm({ businesses }: { businesses: Business[] }) {
  const [state, action, pending] = useActionState(buyNumberAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Area code (optional)" htmlFor="area_code" hint="Local numbers get more answers. Leave empty for any US number.">
          <Input id="area_code" name="area_code" inputMode="numeric" maxLength={3} placeholder="e.g. 214" />
        </Field>
        <Field label="Business" htmlFor="buy_workspace" hint="Calls to this number go to this business.">
          <Select id="buy_workspace" name="workspace_id" defaultValue="">
            <option value="">Assign later</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirm" value="yes" required className="mt-0.5" />
        <span>I understand this adds a monthly charge (about $2) to the card on the Lead96 Retell account.</span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Buying..." : "Buy number"}
      </Button>
    </form>
  );
}

export function AssignNumberForm({ e164, businesses, current }: { e164: string; businesses: Business[]; current: string | null }) {
  const [state, action, pending] = useActionState(assignNumberAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="e164" value={e164} />
      <Select name="workspace_id" defaultValue={current ?? ""} aria-label={`Business for ${e164}`} className="w-56">
        <option value="">Not assigned</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      {state?.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state?.message ? <span className="text-xs text-emerald-700">{state.message}</span> : null}
    </form>
  );
}
