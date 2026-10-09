"use client";

import { useActionState, useState } from "react";
import { Button, Select } from "@/components/ui";
import { assignAccount, syncNow } from "./actions";

type Business = { id: string; name: string };
type Account = { id: string; name: string; currency: string | null; timeZone: string | null };

export function AssignForm({ account, businesses, current }: { account: Account; businesses: Business[]; current: string | null }) {
  const [state, action, pending] = useActionState(assignAccount, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="external_id" value={account.id} />
      <input type="hidden" name="name" value={account.name} />
      <input type="hidden" name="currency" value={account.currency ?? ""} />
      <input type="hidden" name="time_zone" value={account.timeZone ?? ""} />
      <Select name="workspace_id" defaultValue={current ?? ""} aria-label={`Business for ${account.name}`} className="w-56">
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

export function SyncButton({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(syncNow, undefined);
  const s = state?.summary;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="account_id" value={accountId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Syncing..." : "Sync now"}
      </Button>
      {state?.error ? <p className="max-w-sm text-xs text-red-600">{state.error}</p> : null}
      {s ? (
        <p className="text-xs text-emerald-700">
          {s.leadsNew} new lead{s.leadsNew === 1 ? "" : "s"} ({s.leadsKnown} already in) · {s.spendRows} spend rows, {s.spendTotal.toLocaleString("en-US")} total
        </p>
      ) : null}
    </form>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">{value}</code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
