import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { RETELL_SIGNATURE_HEADER, verifyRetell } from "@/lib/voice/signature";
import { runTool, type ToolRequest } from "@/lib/voice/tools";

/**
 * Retell custom tools the AI calls during a conversation (check_availability, book_appointment).
 * Signed with the Retell API key over the raw body, like the call webhook.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/voice/tools/[name]">) {
  const key = serverEnv().RETELL_API_KEY;
  if (!key) return NextResponse.json({ error: "voice not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyRetell(raw, key, request.headers.get(RETELL_SIGNATURE_HEADER))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: ToolRequest;
  try {
    body = JSON.parse(raw);
    if (typeof body?.call?.call_id !== "string") throw new Error("shape");
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { name } = await ctx.params;
  try {
    const r = await runTool({ ...body, name, args: body.args && typeof body.args === "object" ? body.args : {} });
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error(`Voice tool ${name} failed:`, e instanceof Error ? e.message : e);
    // The AI hears this and carries on without the tool.
    return NextResponse.json({ ok: false, instruction: "The schedule is not available right now. Note their preferred day and time and say the team will confirm." });
  }
}
