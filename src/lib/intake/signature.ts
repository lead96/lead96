/**
 * HMAC signatures for server-to-server webhooks into Lead96 (call intake now; the M3 voice
 * service is the sender). Same scheme as Stripe/Slack:
 *
 *   X-Lead96-Timestamp: <unix seconds>
 *   X-Lead96-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * The timestamp is signed too and must be within 5 minutes, so a captured request can't be replayed later.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-lead96-timestamp";
export const SIGNATURE_HEADER = "x-lead96-signature";
const TOLERANCE_SECONDS = 5 * 60;

export function sign(secret: string, timestamp: number | string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_signature" | "stale_timestamp" | "invalid_signature" };

export function verify(opts: {
  secret: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now?: number; // ms, for tests
}): VerifyResult {
  const { secret, body, timestamp, signature } = opts;
  if (!timestamp || !signature) return { ok: false, reason: "missing_signature" };
  const ts = Number(timestamp);
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(nowSec - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = Buffer.from(sign(secret, timestamp, body));
  // A header may carry several signatures during secret rotation: "v1=…,v1=…".
  const match = signature.split(",").some((s) => {
    const given = Buffer.from(s.trim());
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "invalid_signature" };
}
