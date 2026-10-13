/**
 * Retell webhook and custom-tool signatures: header `x-retell-signature: v=<ms>,d=<hex>` where
 * d = HMAC-SHA256(api key, raw body + ms). Same algorithm as the Retell SDK's verify(), valid for
 * 5 minutes. Pure - unit-tested.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const RETELL_SIGNATURE_HEADER = "x-retell-signature";
const WINDOW_MS = 5 * 60 * 1000;

export function signRetell(body: string, apiKey: string, timestampMs = Date.now()) {
  const digest = createHmac("sha256", apiKey).update(body + timestampMs).digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

export function verifyRetell(body: string, apiKey: string, signature: string | null | undefined, nowMs = Date.now()) {
  const m = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(signature ?? "");
  if (!m || !apiKey) return false;
  const ts = Number(m[1]);
  if (!Number.isSafeInteger(ts) || Math.abs(nowMs - ts) > WINDOW_MS) return false;
  const expected = createHmac("sha256", apiKey).update(body + ts).digest();
  const given = Buffer.from(m[2], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
