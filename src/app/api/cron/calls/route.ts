import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { runDueNotifications } from "@/lib/notify/visits";
import { runDueJobs } from "@/lib/voice/jobs";

export const maxDuration = 60;

/**
 * Runs due AI call jobs (deferred fast callbacks and retries) and visit messages (confirmations,
 * reminders). Called every minute by pg_cron in the database (public.call_runner_tick) only when
 * something is due. Protected by CRON_SECRET.
 */
async function handle(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [calls, notifications] = await Promise.all([runDueJobs(10), runDueNotifications(20)]);
  return Response.json({ ran: calls.length + notifications.length, results: calls, notifications });
}

export const POST = handle;
export const GET = handle;
