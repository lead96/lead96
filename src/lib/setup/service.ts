import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAiUsage, structuredCompletion } from "@/lib/ai/openai";
import type { WorkspaceContext } from "@/lib/auth";
import {
  draftFromSaved,
  profileFromDraft,
  questionsFromDraft,
  type AgentQuestion,
  type DemandProfileRow,
  type SetupDraft,
} from "./draft";
import { buildPlan, type PlanModelOutput } from "./plan";
import { PLAN_PROMPT_VERSION, planSchema, planSystemPrompt, type SetupContext } from "./prompts";
import { greetingPrompt, type ChatPrompt } from "./questions";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
  /** Answer buttons shown under an assistant message. */
  options?: string[];
  allow_multiple?: boolean;
  /** The question the owner is answering, when the displayed text is a note/clarification instead. */
  question?: string;
};

export function promptToMessage(p: ChatPrompt, question?: string): ChatMessage {
  return {
    role: "assistant",
    content: p.text,
    at: new Date().toISOString(),
    ...(p.options && { options: p.options }),
    ...(p.allow_multiple && { allow_multiple: true }),
    ...(question && question !== p.text && { question }),
  };
}
export type Conversation = {
  id: string;
  messages: ChatMessage[];
  extracted: SetupDraft;
  status: "active" | "completed";
  total_tokens: number;
  user_turns: number;
};

export async function loadSetupContext(supabase: SupabaseClient, workspace: WorkspaceContext): Promise<SetupContext> {
  const [{ data: taxonomy }, { data: agent }] = await Promise.all([
    supabase
      .from("taxonomy_values")
      .select("category, value, label")
      .eq("vertical", workspace.vertical)
      .in("category", ["service", "customer_type"])
      .order("sort"),
    supabase.from("agent_settings").select("questions").eq("workspace_id", workspace.id).single(),
  ]);
  const of = (category: string) =>
    (taxonomy ?? []).filter((t) => t.category === category).map((t) => ({ value: t.value as string, label: t.label as string }));
  return {
    businessName: workspace.name,
    services: of("service"),
    customerTypes: of("customer_type").filter((c) => c.value !== "unknown"),
    defaultQuestions: ((agent?.questions ?? []) as AgentQuestion[])
      .filter((q) => !q.key.startsWith("custom_"))
      .map((q) => q.question),
  };
}

export async function loadSaved(supabase: SupabaseClient, workspaceId: string) {
  const [{ data: profile }, { data: agent }] = await Promise.all([
    supabase.from("demand_profiles").select("*").eq("workspace_id", workspaceId).single(),
    supabase.from("agent_settings").select("*").eq("workspace_id", workspaceId).single(),
  ]);
  return {
    profile: profile as (DemandProfileRow & { version: number; updated_at: string }) | null,
    agent: agent as
      | { questions: AgentQuestion[]; transfer_phone: string | null; greeting: string | null; version: number }
      | null,
  };
}

export async function getActiveConversation(supabase: SupabaseClient, workspaceId: string) {
  const { data } = await supabase
    .from("setup_conversations")
    .select("id, messages, extracted, status, total_tokens, user_turns")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Conversation | null;
}

/** Start a chat. If setup was saved before, the chat starts from the saved values. */
export async function startConversation(supabase: SupabaseClient, workspace: WorkspaceContext, userId: string, ctx: SetupContext) {
  const isUpdate = Boolean(workspace.setupCompletedAt);
  const { profile, agent } = await loadSaved(supabase, workspace.id);
  const draft = isUpdate ? draftFromSaved(profile, agent) : draftFromSaved(null, null);
  const { data, error } = await supabase
    .from("setup_conversations")
    .insert({
      workspace_id: workspace.id,
      created_by: userId,
      extracted: draft,
      messages: [promptToMessage(greetingPrompt(ctx, isUpdate, draft))],
    })
    .select("id, messages, extracted, status, total_tokens, user_turns")
    .single();
  if (error) throw error;
  return data as Conversation;
}

/** Write the draft to the demand profile and AI call settings (versioned, with an event). */
export async function saveSetup(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  draft: SetupDraft,
  source: "chat" | "form",
) {
  const { profile, agent } = await loadSaved(supabase, workspaceId);
  const now = new Date().toISOString();

  const { error: pErr } = await supabase
    .from("demand_profiles")
    .update({ ...profileFromDraft(draft), version: (profile?.version ?? 0) + 1, updated_by: userId, updated_at: now })
    .eq("workspace_id", workspaceId);
  if (pErr) throw pErr;

  const { error: aErr } = await supabase
    .from("agent_settings")
    .update({
      questions: questionsFromDraft(agent?.questions ?? [], draft),
      transfer_phone: draft.transfer_phone,
      version: (agent?.version ?? 0) + 1,
      updated_by: userId,
      updated_at: now,
    })
    .eq("workspace_id", workspaceId);
  if (aErr) throw aErr;

  await supabase.from("events").insert({
    workspace_id: workspaceId,
    type: "demand_profile.updated",
    subject_table: "demand_profiles",
    subject_id: workspaceId,
    actor_id: userId,
    payload: { source, version: (profile?.version ?? 0) + 1 },
  });
}

/** Ask the model for a plan, fix its numbers in code, store it. Returns the new plan id. */
export async function generateCampaignPlan(
  supabase: SupabaseClient,
  workspace: WorkspaceContext,
  userId: string,
  draft: SetupDraft,
) {
  const { data, usage } = await structuredCompletion<PlanModelOutput>({
    name: "campaign_plan",
    schema: planSchema,
    instructions: planSystemPrompt(),
    input: [{ role: "user", content: JSON.stringify({ business: workspace.name, vertical: workspace.vertical, setup: draft }) }],
  });
  await recordAiUsage(workspace.id, userId, "campaign_plan", usage);

  const { summary, plan } = buildPlan(data, draft);
  const { data: row, error } = await supabase
    .from("campaign_plans")
    .insert({
      workspace_id: workspace.id,
      summary,
      plan,
      source: "chat",
      model: usage.model,
      prompt_version: PLAN_PROMPT_VERSION,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  await supabase.from("events").insert({
    workspace_id: workspace.id,
    type: "campaign_plan.created",
    subject_table: "campaign_plans",
    subject_id: row.id,
    actor_id: userId,
    payload: { model: usage.model, prompt_version: PLAN_PROMPT_VERSION },
  });
  return row.id as string;
}
