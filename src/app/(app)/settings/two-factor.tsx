"use client";

import { ShieldCheck } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { confirmTwoFactor, removeTwoFactor, startTwoFactor, type TwoFactorState } from "./two-factor-actions";

export function TwoFactorCard({ on, since }: { on: boolean; since: string | null }) {
  const [setup, setSetup] = useState<TwoFactorState>(undefined);
  const [starting, startTransition] = useTransition();
  const [confirmState, confirm, confirming] = useActionState(confirmTwoFactor, undefined);
  const [removeState, remove, removing] = useActionState(removeTwoFactor, undefined);
  const [turningOff, setTurningOff] = useState(false);

  if (confirmState?.message || removeState?.message) {
    return <Alert tone="success">{confirmState?.message ?? removeState?.message}</Alert>;
  }

  if (on) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <ShieldCheck size={18} aria-hidden />
          On{since ? ` since ${since}` : ""}
        </p>
        {turningOff ? (
          <form action={remove} className="space-y-2">
            {removeState?.error ? <Alert tone="error">{removeState.error}</Alert> : null}
            <Field label="Current code from your app" htmlFor="off-code">
              <Input id="off-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={removing}>
                {removing ? "Turning off..." : "Turn off"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setTurningOff(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setTurningOff(true)}>
            Turn off
          </Button>
        )}
      </div>
    );
  }

  const factor = confirmState?.factorId ? confirmState : setup;
  if (factor?.factorId && factor.qr) {
    return (
      <form action={confirm} className="space-y-4">
        <input type="hidden" name="factor_id" value={factor.factorId} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...).</li>
          <li>Scan this code, or type the key below.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from Supabase */}
        <img src={factor.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-slate-200 bg-white p-2" />
        <p className="break-all font-mono text-xs text-slate-600">Key: {factor.secret}</p>
        {confirmState?.error ? <Alert tone="error">{confirmState.error}</Alert> : null}
        <Field label="Code from your app" htmlFor="tf-code">
          <Input id="tf-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        </Field>
        <Button type="submit" disabled={confirming}>
          {confirming ? "Checking..." : "Confirm and turn on"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {setup?.error ? <Alert tone="error">{setup.error}</Alert> : null}
      <Button type="button" disabled={starting} onClick={() => startTransition(async () => setSetup(await startTwoFactor()))}>
        {starting ? "Starting..." : "Turn on two-factor sign-in"}
      </Button>
    </div>
  );
}
