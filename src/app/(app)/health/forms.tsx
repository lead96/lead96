"use client";

import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { resolveDuplicate } from "./actions";

type Person = { id: string; name: string };

/** Merge one customer into the other (after a confirm step), or mark them as different people. */
export function DuplicateActions({ a, b }: { a: Person; b: Person }) {
  const [state, action, pending] = useActionState(resolveDuplicate, undefined);
  const [keep, setKeep] = useState<Person | null>(null);
  const other = keep && (keep.id === a.id ? b : a);
  return (
    <div className="space-y-2">
      {keep && other ? (
        <form action={action} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="hidden" name="keep" value={keep.id} />
          <input type="hidden" name="other" value={other.id} />
          <p className="text-slate-700">
            Move everything of <span className="font-medium">{other.name}</span> (leads, calls, visits, texts) to{" "}
            <span className="font-medium">{keep.name}</span>? This can&apos;t be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="action" value="merge" size="sm" disabled={pending}>
              {pending ? "Merging..." : "Merge"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setKeep(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="keep" value={a.id} />
          <input type="hidden" name="other" value={b.id} />
          <Button type="button" size="sm" variant="secondary" onClick={() => setKeep(a)}>
            Keep {a.name}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setKeep(b)}>
            Keep {b.name}
          </Button>
          <Button type="submit" name="action" value="dismiss" size="sm" variant="ghost" disabled={pending}>
            Different people
          </Button>
        </form>
      )}
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
    </div>
  );
}
