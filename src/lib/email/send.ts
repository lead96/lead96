import "server-only";
import { isUndeliverableAddress } from "@/lib/email/address";
import { serverEnv } from "@/lib/env";

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Sends one email through the Resend API (app emails such as invites; auth emails go through
 * Supabase SMTP). Never throws: callers decide what to show when sending fails.
 * `idempotencyKey` makes a retried call send only once.
 */
export async function sendEmail(email: Email, idempotencyKey?: string): Promise<SendResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not set" };
  if (isUndeliverableAddress(email.to)) return { ok: false, error: `${email.to} is a test address; not sent` };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!res.ok || !body.id)
      return {
        ok: false,
        error: `Resend ${res.status}: ${body.message ?? body.name ?? "unknown error"}`,
      };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
