import { after, NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { logDelivery } from "@/lib/intake/deliveries";
import { RETELL_SIGNATURE_HEADER, verifyRetell } from "@/lib/voice/signature";
import type { RetellChat } from "@/lib/voice/retell";
import { handleChatEvent } from "@/lib/voice/texts";
import { handleRetellEvent, storeRecording, type RetellEvent } from "@/lib/voice/webhook";

/**
 * Retell call events (call_started, call_ended, call_analyzed) for every Lead96 agent.
 * Signed with the Retell API key over the raw body. 2xx = done; 5xx = Retell retries (up to 3x).
 */
export async function POST(request: NextRequest) {
  const key = serverEnv().RETELL_API_KEY;
  if (!key) return NextResponse.json({ error: "voice not configured" }, { status: 503 });

  const raw = await request.text();
  if (!verifyRetell(raw, key, request.headers.get(RETELL_SIGNATURE_HEADER))) {
    await logDelivery({ provider: "retell", status: "rejected", error: "bad or missing x-retell-signature", workspaceId: null, externalId: null, payload: null });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Text conversations (Retell SMS chat agent) use the same webhook with chat_* events.
  let parsed: { event?: unknown; chat?: RetellChat } | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}
  if (typeof parsed?.event === "string" && parsed.event.startsWith("chat_") && typeof parsed.chat?.chat_id === "string") {
    const chat = parsed.chat;
    const externalId = `${chat.chat_id}:${parsed.event}`;
    try {
      const r = await handleChatEvent(parsed.event, chat);
      if (r.status !== "duplicate") await logDelivery({ provider: "retell", status: r.status, error: r.error, workspaceId: r.workspaceId, externalId, payload: { event: parsed.event, chat_id: chat.chat_id, status: chat.chat_status } });
      return new NextResponse(null, { status: 204 });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await logDelivery({ provider: "retell", status: "failed", error, workspaceId: null, externalId, payload: { event: parsed.event, chat_id: chat.chat_id } });
      return NextResponse.json({ error: "temporary failure" }, { status: 500 });
    }
  }

  let body: RetellEvent;
  try {
    body = JSON.parse(raw);
    if (typeof body?.event !== "string" || typeof body?.call?.call_id !== "string") throw new Error("shape");
  } catch {
    await logDelivery({ provider: "retell", status: "rejected", error: "not a Retell call event", workspaceId: null, externalId: null, payload: null });
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const externalId = `${body.call.call_id}:${body.event}`;
  // Keep the log small: the full transcript lives on the call row.
  const logged = { event: body.event, call_id: body.call.call_id, status: body.call.call_status, direction: body.call.direction ?? null, reason: body.call.disconnection_reason ?? null };
  try {
    const r = await handleRetellEvent(body);
    if (r.status !== "duplicate" || body.event === "call_analyzed")
      await logDelivery({ provider: "retell", status: r.status, error: r.error, workspaceId: r.workspaceId, externalId, payload: logged });
    if (body.event === "call_analyzed" && r.workspaceId && r.callRowId) {
      const { workspaceId, callRowId } = r;
      after(() => storeRecording(workspaceId, callRowId, body.call.recording_url));
    }
    // Unknown business: retrying will not help, so answer 2xx and keep it in the problem log.
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("Retell webhook failed:", error);
    await logDelivery({ provider: "retell", status: "failed", error, workspaceId: null, externalId, payload: logged });
    return NextResponse.json({ error: "temporary failure" }, { status: 500 });
  }
}
