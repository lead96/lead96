import "server-only";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { buildAgentConfig, configHash, VOICE_PROMPT_VERSION, type VoiceAgentConfig } from "./agent-config";
import { loadAgentInput } from "./input";
import { bindNumber, RetellError, upsertAgent } from "./retell";

/**
 * Where Retell sends call events. Retell cannot reach localhost, so local development uses the
 * live site (same database) for webhooks.
 */
export function voiceWebhookBase() {
  const app = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return /localhost|127\.0\.0\.1/.test(app) ? "https://lead96.com" : app;
}

export type SyncResult = { status: "created" | "updated" | "unchanged"; version: number; agentId: string } | { status: "error"; error: string };

/**
 * Builds the business's AI caller from its current setup and pushes it to Retell when anything
 * changed. Every pushed config is kept in voice_agent_versions.
 */
export async function syncVoiceAgent(workspaceId: string, actorId: string | null, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const db = createAdminClient();
  const config = buildAgentConfig(await loadAgentInput(workspaceId));
  const webhookUrl = `${voiceWebhookBase()}/api/voice/retell`;
  const hash = configHash(config, { webhookUrl });

  const { data: current } = await db
    .from("voice_agents")
    .select("retell_agent_id, retell_llm_id, version, config_hash")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (current?.retell_agent_id && current.config_hash === hash && !opts.force) {
    return { status: "unchanged", version: current.version, agentId: current.retell_agent_id };
  }

  let ids;
  try {
    ids = await upsertAgent(config, { llmId: current?.retell_llm_id ?? undefined, agentId: current?.retell_agent_id ?? undefined }, webhookUrl);
  } catch (e) {
    const error = e instanceof RetellError ? e.message : e instanceof Error ? e.message : "Could not reach Retell.";
    await db
      .from("voice_agents")
      .upsert({ workspace_id: workspaceId, last_error: error, last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
    return { status: "error", error };
  }

  const version = (current?.version ?? 0) + 1;
  await db.from("voice_agent_versions").insert({ workspace_id: workspaceId, version, config: config as unknown as Record<string, unknown>, created_by: actorId });
  await db.from("voice_agents").upsert(
    {
      workspace_id: workspaceId,
      retell_agent_id: ids.agentId,
      retell_llm_id: ids.llmId,
      version,
      config_hash: hash,
      synced_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  // Numbers already assigned to the business now answer with this agent.
  const { data: numbers } = await db.from("phone_numbers").select("e164").eq("workspace_id", workspaceId);
  for (const n of numbers ?? []) await bindNumber(n.e164, ids.agentId).catch(() => null);

  return { status: current?.retell_agent_id ? "updated" : "created", version, agentId: ids.agentId };
}

/** The config a business's calls currently use (for showing the script in the app). */
export async function currentAgentConfig(workspaceId: string): Promise<VoiceAgentConfig | null> {
  const { data } = await createAdminClient()
    .from("voice_agent_versions")
    .select("config")
    .eq("workspace_id", workspaceId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.config as VoiceAgentConfig | undefined) ?? null;
}

export { VOICE_PROMPT_VERSION };
