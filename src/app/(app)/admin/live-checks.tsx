"use client";

import { useActionState } from "react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { liveChecks } from "./actions";

export function LiveChecks() {
  const [state, run, pending] = useActionState(liveChecks, undefined);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Live checks</h2>
          <p className="text-sm text-slate-500">Calls each service now to confirm the credentials work. Free, changes nothing.</p>
        </div>
        <form action={run}>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Checking…" : state?.checks ? "Run again" : "Run live checks"}
          </Button>
        </form>
      </div>
      {state?.error ? (
        <div className="mt-4">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state?.checks ? (
        <ul className="mt-4 divide-y divide-slate-100 text-sm" aria-label="Live check results">
          {state.checks.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Badge tone={c.ok === null ? "slate" : c.ok ? "green" : "red"}>{c.ok === null ? "Skipped" : c.ok ? "OK" : "Failed"}</Badge>
              <span className="font-medium text-slate-900">{c.label}</span>
              <span className="text-slate-600">{c.detail}</span>
              {c.ms !== null ? <span className="ml-auto text-xs text-slate-400">{c.ms} ms</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
