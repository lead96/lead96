#!/usr/bin/env node
/**
 * Sends a signed test call to the call-intake endpoint — the same request the M3 voice service will send.
 * Needs INTAKE_SIGNING_SECRET in .env.local (the app must use the same value).
 *
 *   npm run intake:test-call -- --workspace <workspace id> [--from "(305) 555-0142"] [--url https://app.lead96.com]
 *                                [--status completed|missed|voicemail] [--source google] [--campaign "AC Repair - Miami"]
 *                                [--call-id CA123]   (re-use an id to test retries)
 */
import crypto from "node:crypto";
import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const secret = process.env.INTAKE_SIGNING_SECRET;
if (!secret) {
  console.error("Missing INTAKE_SIGNING_SECRET in .env.local");
  process.exitCode = 1;
} else if (!args.workspace) {
  console.error("Usage: npm run intake:test-call -- --workspace <workspace id> [--from <phone>] [--url <app url>]");
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  const base = (args.url ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const status = args.status ?? "completed";
  const payload = {
    call_id: args["call-id"] ?? `test_${crypto.randomUUID()}`,
    workspace_id: args.workspace,
    from: args.from ?? "(305) 555-0142",
    to: "+13055550100",
    started_at: new Date().toISOString(),
    duration_seconds: status === "missed" ? 0 : 154,
    status,
    answered_by: status === "missed" ? "none" : status === "voicemail" ? "voicemail" : "ai",
    caller_name: args.name ?? "Test Caller",
    zip: "33101",
    service: "ac_repair",
    summary: status === "missed" ? null : "AC stopped cooling this morning. Homeowner, wants someone today. Asked about price range.",
    tracking: args.source ? { source: args.source, campaign_name: args.campaign ?? null } : null,
    answers: status === "missed" ? undefined : { urgency: "today", homeowner: "yes" },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

  const res = await fetch(`${base}/api/intake/call`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lead96-timestamp": String(timestamp), "x-lead96-signature": signature },
    body,
  });
  console.log(`POST ${base}/api/intake/call → ${res.status}`);
  console.log(await res.text());
  if (!res.ok) process.exitCode = 1;
}
