"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiUnavailableError, recordAiUsage, structuredCompletion } from "@/lib/ai/openai";
import { requireOwner, requireUser } from "@/lib/auth";
import { mergeUpdates, missingFields, type DraftUpdates, type RequiredField, type SetupDraft } from "@/lib/setup/draft";
import { SETUP_PROMPT_VERSION, setupSystemPrompt, setupTurnSchema } from "@/lib/setup/prompts";
import {
  generateCampaignPlan,
  getActiveConversation,
  loadSetupContext,
  saveSetup,
  startConversation,
  type ChatMessage,
} from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";

export type ChatState = {
  messages: ChatMessage[];
  draft: SetupDraft;
  missing: RequiredField[];
  error?: string;
  /** Text to put back in the input after an error, so nothing the owner typed is lost. */
  unsent?: string;
};

const MAX_MESSAGE_CHARS = 800;
const MAX_USER_TURNS = 40;
const MAX_TOKENS_PER_CONVERSATION = 80_000;
const HISTORY_MESSAGES = 24;

/** Friendly sentence appended when the owner's answer could not be saved. */
function rejectionNote(rejected: string[]) {
  const notes = new Set<string>();
  for (const r of rejected) {
    if (r.startsWith("zip_codes")) notes.add("I couldn't find a valid 5-digit ZIP code there — could you type the ZIP codes you serve?");
    else if (r.startsWith("booking_hours")) notes.add("I couldn't read those hours — could you write them like “Mon–Fri 8am–5pm”?");
    else if (r.startsWith("transfer_phone")) notes.add("That phone number doesn't look like a valid US number — could you check it?");
    else if (/^(capacity_per_day|appointment_minutes|monthly_budget|target_cost_per_appointment)/.test(r))
      notes.add("One of those numbers looks out of range, so I didn't save it — could you check it?");
  }
  return [...notes].join(" ");
}

export async function sendSetupMessage(prev: ChatState, formData: FormData): Promise<ChatState> {
  const workspace = await requireOwner();
  const user = await requireUser();
  const text = String(formData.get("message") ?? "").trim();
  if (!text) return { ...prev, error: undefined };
  if (text.length > MAX_MESSAGE_CHARS) {
    return { ...prev, error: `Please keep messages under ${MAX_MESSAGE_CHARS} characters.`, unsent: text };
  }

  const supabase = await createClient();
  const conversation = (await getActiveConversation(supabase, workspace.id)) ?? (await startConversation(supabase, workspace, user.id));
  if (conversation.user_turns >= MAX_USER_TURNS || conversation.total_tokens >= MAX_TOKENS_PER_CONVERSATION) {
    return {
      ...prev,
      error: "This chat has reached its length limit. Please finish the remaining fields in the form on your Business profile page.",
      unsent: text,
    };
  }

  const ctx = await loadSetupContext(supabase, workspace);
  const history = conversation.messages.slice(-HISTORY_MESSAGES).map(({ role, content }) => ({ role, content }));

  let result;
  try {
    result = await structuredCompletion<{ reply: string; updates: DraftUpdates }>({
      name: "setup_turn",
      schema: setupTurnSchema(ctx),
      instructions: setupSystemPrompt(ctx, conversation.extracted, []),
      input: [...history, { role: "user", content: text }],
      maxOutputTokens: 800,
    });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) throw e;
    return {
      ...prev,
      error: "The assistant isn't responding right now. Please try again in a moment, or fill in the form instead.",
      unsent: text,
    };
  }

  const { draft, rejected } = mergeUpdates(conversation.extracted, result.data.updates, {
    services: ctx.services.map((s) => s.value),
    customerTypes: ctx.customerTypes.map((s) => s.value),
  });
  const note = rejectionNote(rejected);
  const now = new Date().toISOString();
  const messages: ChatMessage[] = [
    ...conversation.messages,
    { role: "user", content: text, at: now },
    { role: "assistant", content: [result.data.reply.trim(), note].filter(Boolean).join("\n\n"), at: now },
  ];

  const { error } = await supabase
    .from("setup_conversations")
    .update({
      messages,
      extracted: draft,
      total_tokens: conversation.total_tokens + result.usage.totalTokens,
      user_turns: conversation.user_turns + 1,
      updated_at: now,
    })
    .eq("id", conversation.id);
  if (error) throw error;
  await recordAiUsage(workspace.id, user.id, "setup_chat", result.usage);
  if (rejected.length) console.warn(`setup chat (${SETUP_PROMPT_VERSION}) rejected:`, rejected);

  return { messages, draft, missing: missingFields(draft) };
}

/** Save the collected setup, create the campaign plan, and mark setup complete. */
export async function finishSetup() {
  const workspace = await requireOwner();
  const user = await requireUser();
  const supabase = await createClient();
  const conversation = await getActiveConversation(supabase, workspace.id);
  if (!conversation || missingFields(conversation.extracted).length > 0) redirect("/setup");

  await saveSetup(supabase, workspace.id, user.id, conversation.extracted, "chat");

  let planFailed = false;
  try {
    await generateCampaignPlan(supabase, workspace, user.id, conversation.extracted);
  } catch (e) {
    // The profile is saved either way; the owner can retry the plan from the profile page.
    console.error("campaign plan failed:", e instanceof Error ? e.message : e);
    planFailed = true;
  }

  await supabase
    .from("setup_conversations")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", conversation.id);
  if (!workspace.setupCompletedAt) {
    await supabase.from("workspaces").update({ setup_completed_at: new Date().toISOString() }).eq("id", workspace.id);
  }

  revalidatePath("/", "layout");
  redirect(`/profile?saved=setup${planFailed ? "&plan=failed" : ""}`);
}

/** Drop the current chat and start fresh (saved settings are not touched). */
export async function restartSetup() {
  const workspace = await requireOwner();
  const supabase = await createClient();
  await supabase
    .from("setup_conversations")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id)
    .eq("status", "active");
  revalidatePath("/setup");
  redirect("/setup");
}
