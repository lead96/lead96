"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { setTextingStatusAction } from "./actions";

export function TextingStatusForm({ workspaceId, status, note }: { workspaceId: string; status: string; note: string | null }) {
  const [state, action, pending] = useActionState(setTextingStatusAction, undefined);
  const [value, setValue] = useState(status === "submitted" ? "in_review" : status);
  const [text, setText] = useState(note ?? "");
  return (
    <form
      // Submitted by hand so React doesn't reset the form: a refused save keeps the chosen status.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="workspace_id" value={workspaceId} />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select name="status" value={value} onChange={(e) => setValue(e.target.value)} className="sm:w-56" aria-label="Status">
          <option value="submitted">Sent by owner (not filed)</option>
          <option value="in_review">Filed in Retell, in review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Needs changes (back to owner)</option>
        </Select>
        <Input name="note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Note for the owner (required for Needs changes)" aria-label="Note" />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
