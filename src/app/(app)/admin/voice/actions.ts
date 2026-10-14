"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { leadCallVariables } from "@/lib/voice/agent-config";
import { currentAgentConfig, syncVoiceAgent } from "@/lib/voice/agents";
import { bindNumber, buyNumber, createWebCall, RetellError } from "@/lib/voice/retell";

async function requirePlatformAdmin() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) throw new Error("Platform admins only.");
  return profile;
}

async function audit(actorId: string, action: string, target: string, metadata: Record<string, unknown> = {}, workspaceId: string | null = null) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, target, metadata, workspace_id: workspaceId });
}

/** The business's Retell agent, if it has one yet (numbers are bound to it once it exists). */
async function agentOf(workspaceId: string | null) {
  if (!workspaceId) return { voice: null, sms: null };
  const { data } = await createAdminClient().from("voice_agents").select("retell_agent_id, retell_chat_agent_id").eq("workspace_id", workspaceId).maybeSingle();
  return { voice: data?.retell_agent_id ?? null, sms: data?.retell_chat_agent_id ?? null };
}

export type NumberState = { error?: string; message?: string } | undefined;

/** Buys a US number in the Lead96 Retell account and (optionally) assigns it to a business. */
export async function buyNumberAction(_: NumberState, formData: FormData): Promise<NumberState> {
  const profile = await requirePlatformAdmin();
  const areaRaw = String(formData.get("area_code") ?? "").trim();
  if (areaRaw && !/^[2-9]\d{2}$/.test(areaRaw)) return { error: "Area code must be 3 digits, like 214." };
  if (formData.get("confirm") !== "yes") return { error: "Tick the box to confirm the monthly cost." };
  const workspaceId = String(formData.get("workspace_id") ?? "") || null;

  const db = createAdminClient();
  let businessName: string | null = null;
  if (workspaceId) {
    const { data } = await db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    if (!data) return { error: "Business not found." };
    businessName = data.name;
  }

  let bought;
  try {
    bought = await buyNumber({ areaCode: areaRaw ? Number(areaRaw) : undefined, nickname: businessName ?? "Lead96 (unassigned)" });
  } catch (e) {
    const msg = e instanceof RetellError ? e.message : "Could not reach Retell.";
    await audit(profile.id, "voice.number_buy_failed", areaRaw || "any", { error: msg });
    if (/kyc/i.test(msg))
      return {
        error:
          "Retell needs an identity check (KYC) on the account first. Buy the first number in the Retell dashboard (Phone Numbers) to start it; after that this button works.",
      };
    if (/no (available )?(phone )?numbers? (available|found)|not available/i.test(msg))
      return { error: `No numbers available${areaRaw ? ` in area code ${areaRaw}` : ""}. Try another area code.` };
    return { error: msg };
  }

  const { error } = await db
    .from("phone_numbers")
    .insert({ e164: bought.phone_number, workspace_id: workspaceId, provider: "retell", nickname: businessName, created_by: profile.id });
  // The number is bought either way; a failed insert only means the list below must be refreshed.
  await audit(profile.id, "voice.number_bought", bought.phone_number, { area_code: areaRaw || null, saved: !error }, workspaceId);

  const agent = await agentOf(workspaceId);
  if (agent.voice) await bindNumber(bought.phone_number, agent.voice, { smsAgentId: agent.sms }).catch(() => null);

  revalidatePath("/admin/voice");
  return { message: `Bought ${bought.phone_number_pretty ?? bought.phone_number}${businessName ? ` for ${businessName}` : ""}.` };
}

/** Assigns a number to a business (or unassigns it). Calls to it then belong to that business. */
export async function assignNumberAction(_: NumberState, formData: FormData): Promise<NumberState> {
  const profile = await requirePlatformAdmin();
  const e164 = String(formData.get("e164") ?? "");
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return { error: "Invalid number." };
  const workspaceId = String(formData.get("workspace_id") ?? "") || null;
  const db = createAdminClient();

  const name = workspaceId ? (await db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle()).data?.name : null;
  if (workspaceId && !name) return { error: "Business not found." };
  const { error } = await db
    .from("phone_numbers")
    .upsert({ e164, workspace_id: workspaceId, provider: "retell", nickname: name ?? null, created_by: profile.id }, { onConflict: "e164" });
  if (error) return { error: "Could not save." };

  try {
    const agent = await agentOf(workspaceId);
    await bindNumber(e164, agent.voice, { nickname: name ?? "Lead96 (unassigned)", smsAgentId: agent.sms });
  } catch (e) {
    return { error: `Saved, but Retell was not updated: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  await audit(profile.id, workspaceId ? "voice.number_assigned" : "voice.number_unassigned", e164, {}, workspaceId);
  revalidatePath("/admin/voice");
  return { message: workspaceId ? `Assigned to ${name}.` : "Not assigned." };
}

export type SyncAgentState = { error?: string; message?: string } | undefined;

/** Builds the business's AI caller from its setup and creates/updates it in Retell. */
export async function syncAgentAction(_: SyncAgentState, formData: FormData): Promise<SyncAgentState> {
  const profile = await requirePlatformAdmin();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!workspaceId) return { error: "Missing business." };
  const r = await syncVoiceAgent(workspaceId, profile.id, { force: formData.get("force") === "1" });
  if (r.status === "error") return { error: r.error };
  if (r.status !== "unchanged") await audit(profile.id, `voice.agent_${r.status}`, r.agentId, { version: r.version }, workspaceId);
  revalidatePath("/admin/voice");
  return { message: r.status === "unchanged" ? `Already up to date (version ${r.version}).` : `AI caller ${r.status} (version ${r.version}).` };
}

export type TestCallState =
  | { error?: string; accessToken?: string; callId?: string; transport?: "livekit" | "gateway"; url?: string; iceServers?: RTCIceServer[] }
  | undefined;

/** Starts a browser test call with the business's AI caller, as if calling back a new lead. */
export async function startTestCallAction(_: TestCallState, formData: FormData): Promise<TestCallState> {
  const profile = await requirePlatformAdmin();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const { data: agent } = await createAdminClient().from("voice_agents").select("retell_agent_id").eq("workspace_id", workspaceId).maybeSingle();
  const config = await currentAgentConfig(workspaceId);
  if (!agent?.retell_agent_id || !config) return { error: "Create the AI caller first." };
  const name = String(formData.get("lead_name") ?? "").trim().slice(0, 80) || "Maria Lopez";
  const service = String(formData.get("lead_service") ?? "").trim().slice(0, 80) || "AC repair";
  const zip = String(formData.get("lead_zip") ?? "").trim().slice(0, 10) || "unknown";
  try {
    const call = await createWebCall(
      agent.retell_agent_id,
      leadCallVariables(config, { full_name: name, service: null, zip, source: "test", serviceLabel: service, known: false }),
      { workspace_id: workspaceId, trigger: "test", started_by: profile.id },
    );
    await audit(profile.id, "voice.test_call", call.call_id, {}, workspaceId);
    return { accessToken: call.access_token, callId: call.call_id, transport: call.transport, url: call.url, iceServers: call.ice_servers };
  } catch (e) {
    return { error: e instanceof RetellError ? e.message : "Could not start the test call." };
  }
}
