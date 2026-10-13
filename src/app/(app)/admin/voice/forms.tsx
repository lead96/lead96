"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { assignNumberAction, buyNumberAction, startTestCallAction, syncAgentAction } from "./actions";

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

export function SyncAgentForm({ workspaceId, exists }: { workspaceId: string; exists: boolean }) {
  const [state, action, pending] = useActionState(syncAgentAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <Button type="submit" variant={exists ? "secondary" : "primary"} size="sm" disabled={pending}>
        {pending ? "Saving..." : exists ? "Update from setup" : "Create AI caller"}
      </Button>
      {state?.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state?.message ? <span className="text-xs text-emerald-700">{state.message}</span> : null}
    </form>
  );
}

type Line = { role: string; content: string };

/** Talk to the business's AI caller from the browser (microphone), as a new lead would on the phone. */
export function TestCall({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(startTestCallAction, undefined);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended" | "error">("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const client = useRef<{ stopCall: () => void } | null>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    const token = state?.accessToken;
    if (!token || started.current === token) return;
    started.current = token;
    let cancelled = false;
    (async () => {
      try {
        setStatus("connecting");
        setLines([]);
        setProblem(null);
        const { RetellWebClient } = await import("retell-client-js-sdk");
        if (cancelled) return;
        const c = new RetellWebClient();
        client.current = c;
        c.on("call_started", () => setStatus("live"));
        c.on("call_ended", () => setStatus("ended"));
        c.on("error", (e: unknown) => {
          setProblem(e instanceof Error ? e.message : "Call error");
          setStatus("error");
          c.stopCall();
        });
        c.on("update", (u: { transcript?: Line[] }) => {
          if (u?.transcript) setLines(u.transcript.slice(-12));
        });
        // Retell picks the transport per call ("gateway" needs the call id and ICE servers too).
        await c.startCall({ accessToken: token, transport: state?.transport, callId: state?.callId, url: state?.url, iceServers: state?.iceServers });
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Could not start the call (microphone blocked?)");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      // React may run this effect twice (dev Strict Mode): if the call had not started yet, let the next run start it.
      if (!client.current) started.current = null;
    };
  }, [state]);

  useEffect(() => () => client.current?.stopCall(), []);
  const live = status === "connecting" || status === "live";

  return (
    <div className="space-y-3">
      {live ? (
        <div className="flex items-center gap-3">
          <Badge tone="blue">{status === "live" ? "On the call" : "Connecting..."}</Badge>
          <Button type="button" variant="secondary" size="sm" onClick={() => client.current?.stopCall()}>
            Hang up
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <Input name="lead_name" placeholder="Lead name (Maria Lopez)" aria-label="Lead name" className="w-48" />
          <Input name="lead_service" placeholder="Service (AC repair)" aria-label="Service" className="w-40" />
          <Input name="lead_zip" placeholder="ZIP" aria-label="ZIP" className="w-24" inputMode="numeric" />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Starting..." : "Test in browser"}
          </Button>
        </form>
      )}
      {state?.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {problem ? <p className="text-xs text-red-600">{problem}</p> : null}
      {status === "ended" ? <p className="text-xs text-slate-500">Call ended. The result appears in the business&apos;s calls within a minute.</p> : null}
      {lines.length ? (
        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs">
          {lines.map((l, i) => (
            <p key={i}>
              <span className="font-medium text-slate-500">{l.role === "agent" ? "AI" : "You"}:</span> <span className="text-slate-800">{l.content}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
