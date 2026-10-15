"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { APPROVE_MEANS, type ReviewField } from "@/lib/review/items";
import { resolveReview } from "./actions";

export function ReviewItemForm({
  id,
  field,
  options,
  unsure,
}: {
  id: string;
  field: ReviewField;
  /** Choices for a correction (call results or services); revenue takes an amount. */
  options: { value: string; label: string }[];
  unsure: boolean;
}) {
  const [state, action, pending] = useActionState(resolveReview, undefined);
  const [correcting, setCorrecting] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      // Submitted by hand so React doesn't reset the form after a refused save.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(fd));
      }}
      className="space-y-2"
    >
      <input type="hidden" name="item_id" value={id} />
      <input type="hidden" name="field" value={field} />
      {correcting ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {field === "revenue" ? (
            <Input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Right amount in $" aria-label="Right amount" />
          ) : (
            <Select name="value" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Right value">
              <option value="">{field === "service" ? "Choose the service" : "Choose the right result"}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" name="action" value="correct" size="sm" disabled={pending} className="shrink-0">
            {pending ? "Saving..." : "Save correction"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCorrecting(false)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="action" value="approve" size="sm" disabled={pending} title={APPROVE_MEANS[field]}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setCorrecting(true)}>
            Correct
          </Button>
          <Button type="submit" name="action" value="reject" size="sm" variant="secondary" disabled={pending} title="Not usable, e.g. a junk call">
            Reject
          </Button>
          {unsure ? null : (
            <Button type="submit" name="action" value="unsure" size="sm" variant="ghost" disabled={pending}>
              Not sure
            </Button>
          )}
        </div>
      )}
      <Input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional)" maxLength={500} aria-label="Why" />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
