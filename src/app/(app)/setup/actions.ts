"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiUnavailableError, recordAiUsage, structuredCompletion } from "@/lib/ai/openai";
import { requireOwner, requireUser } from "@/lib/auth";
import {
  MAX_AREA_ZIPS,
  cityLabel,
  clampRadius,
  describeAreaResult,
  extractZipList,
  type AreaLookup,
} from "@/lib/setup/area";
import { mergeUpdates, missingFields, type DraftUpdates, type RequiredField, type SetupDraft } from "@/lib/setup/draft";
import { SETUP_PROMPT_VERSION, setupSystemPrompt, setupTurnSchema } from "@/lib/setup/prompts";
import { nextQuestion, type ChatPrompt } from "@/lib/setup/questions";
import {
  generateCampaignPlan,
  getActiveConversation,
  loadSetupContext,
  promptToMessage,
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
const MAX_ZIP_LIST_CHARS = 20_000;
const MAX_USER_TURNS = 40;
const MAX_TOKENS_PER_CONVERSATION = 80_000;
const HISTORY_MESSAGES = 16;

type ModelTurn = { reply: string; understood: boolean; updates: DraftUpdates; area_lookup: AreaLookup | null };

/**
 * When the owner's answer fails validation, this replaces the model's reply: the model
 * can't know the value was refused and would otherwise move on as if it was accepted.
 */
function rejectionReply(rejected: string[]) {
  const notes = new Set<string>();
  for (const r of rejected) {
    if (r.startsWith("zip_codes")) notes.add("I couldn't find a valid 5-digit ZIP code there. You can also just tell me a city and how far you travel, like “Miami, 20 miles”.");
    else if (r.startsWith("booking_hours")) notes.add("I couldn't read those hours — could you write them like “Mon–Fri 8am–5pm”?");
    else if (r.startsWith("transfer_phone")) notes.add("That phone number doesn't look like a valid US number — could you send it again with the area code, like (214) 555-0100?");
    else if (/^(capacity_per_day|appointment_minutes|monthly_budget|target_cost_per_appointment)/.test(r))
      notes.add("One of those numbers looks out of range, so I didn't save it — could you check it?");
  }
  return [...notes].join(" ");
}

type AreaResult =
  | { kind: "ok"; zips: string[]; label: string; miles: number; truncated: boolean }
  | { kind: "ambiguous"; city: string; choices: string[] }
  | { kind: "none"; place: string };

/** Turn "Miami, 20 miles" into real ZIP codes from us_zip_codes. */
async function resolveArea(supabase: SupabaseClient, lookup: AreaLookup): Promise<AreaResult | null> {
  const miles = clampRadius(lookup.radius_miles);
  let center: { lat: number; lng: number; label: string } | null = null;

  const zip = lookup.center_zip?.match(/\d{5}/)?.[0];
  if (zip) {
    const { data } = await supabase.from("us_zip_codes").select("lat, lng, city, state").eq("zip", zip).maybeSingle();
    if (!data) return { kind: "none", place: zip };
    center = { lat: data.lat, lng: data.lng, label: `${cityLabel(data.city, data.state)} (${zip})` };
  } else if (lookup.city?.trim()) {
    const { data } = await supabase.rpc("zip_city_matches", { p_city: lookup.city, p_state: lookup.state || null });
    const rows = (data ?? []) as { city: string; state: string; zip_count: number; lat: number; lng: number }[];
    if (rows.length === 0) return { kind: "none", place: lookup.state ? cityLabel(lookup.city, lookup.state) : lookup.city };
    if (rows.length > 1 && !lookup.state) {
      return { kind: "ambiguous", city: rows[0].city, choices: rows.slice(0, 6).map((r) => cityLabel(r.city, r.state)) };
    }
    center = { lat: rows[0].lat, lng: rows[0].lng, label: cityLabel(rows[0].city, rows[0].state) };
  } else {
    return null;
  }

  const { data, error } = await supabase.rpc("zips_within", { p_lat: center.lat, p_lng: center.lng, p_miles: miles, p_limit: MAX_AREA_ZIPS + 1 });
  if (error) throw error;
  const zips = ((data ?? []) as { zip: string }[]).map((r) => r.zip);
  return { kind: "ok", zips: zips.slice(0, MAX_AREA_ZIPS), label: center.label, miles, truncated: zips.length > MAX_AREA_ZIPS };
}

export async function sendSetupMessage(prev: ChatState, formData: FormData): Promise<ChatState> {
  const workspace = await requireOwner();
  const user = await requireUser();
  const text = String(formData.get("message") ?? "").trim();
  if (!text) return { ...prev, error: undefined };

  // A pasted/uploaded ZIP list skips the model entirely.
  const zipList = extractZipList(text);
  const cap = zipList ? MAX_ZIP_LIST_CHARS : MAX_MESSAGE_CHARS;
  if (text.length > cap) return { ...prev, error: `Please keep messages under ${cap} characters.`, unsent: text };

  const supabase = await createClient();
  const [existing, ctx] = await Promise.all([getActiveConversation(supabase, workspace.id), loadSetupContext(supabase, workspace)]);
  const conversation = existing ?? (await startConversation(supabase, workspace, user.id, ctx));
  if (conversation.user_turns >= MAX_USER_TURNS || conversation.total_tokens >= MAX_TOKENS_PER_CONVERSATION) {
    return {
      ...prev,
      error: "This chat has reached its length limit. Please finish the remaining fields on your Business profile page.",
      unsent: text,
    };
  }

  const vocab = { services: ctx.services.map((s) => s.value), customerTypes: ctx.customerTypes.map((s) => s.value) };
  const last = conversation.messages.at(-1);
  const pending: ChatPrompt =
    last?.role === "assistant"
      ? { text: last.question ?? last.content, options: last.options, allow_multiple: last.allow_multiple }
      : nextQuestion(conversation.extracted, ctx);

  let draft = conversation.extracted;
  let rejected: string[] = [];
  let ack = "";
  let note = "";
  let followUp: ChatPrompt | null = null;
  let turn: ModelTurn | null = null;
  let usage: Awaited<ReturnType<typeof structuredCompletion>>["usage"] | null = null;

  if (zipList) {
    ({ draft, rejected } = mergeUpdates(draft, { zip_codes: zipList }, vocab));
    draft.area_description = null;
    ack = `Got it — ${zipList.length} ZIP code${zipList.length === 1 ? "" : "s"}.`;
  } else {
    const history = conversation.messages.slice(-HISTORY_MESSAGES).map(({ role, content }) => ({ role, content }));
    try {
      const result = await structuredCompletion<ModelTurn>({
        name: "setup_turn",
        schema: setupTurnSchema(ctx),
        instructions: setupSystemPrompt(ctx, draft, pending),
        input: [...history, { role: "user", content: text }],
        maxOutputTokens: 700,
      });
      turn = result.data;
      usage = result.usage;
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      return {
        ...prev,
        error: "The assistant isn't responding right now. Please try again in a moment, or fill in the form instead.",
        unsent: text,
      };
    }

    // A place lookup supersedes whatever the model put in zip_codes (often the place name itself).
    if (turn.area_lookup) turn.updates = { ...turn.updates, zip_codes: null };
    ({ draft, rejected } = mergeUpdates(draft, turn.updates, vocab));
    if (turn.updates.zip_codes?.length && draft.zip_codes !== conversation.extracted.zip_codes) draft.area_description = null;

    if (turn.area_lookup) {
      const area = await resolveArea(supabase, turn.area_lookup);
      if (area?.kind === "ok") {
        draft = { ...draft, zip_codes: area.zips, area_description: `${area.label} · ${area.miles} mi` };
        note = describeAreaResult(area.zips, area.label, area.miles);
        if (area.truncated) note += ` That's a big area, so I kept the nearest ${MAX_AREA_ZIPS}. Tell me a smaller radius if you like.`;
      } else if (area?.kind === "ambiguous") {
        followUp = { text: `Which ${area.city} do you mean?`, options: area.choices };
      } else if (area?.kind === "none") {
        followUp = { text: `I couldn't find a place called “${area.place}”. Could you check the spelling, add the state, or paste your ZIP codes?` };
      }
    }
    if (turn.understood && turn.reply.length <= 120) ack = turn.reply.trim();
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(conversation.extracted);
  let reply: ChatPrompt;
  let question: string; // what the owner answers next (given to the model; shown only when it is the reply itself)
  if (rejected.length) {
    reply = { text: rejectionReply(rejected), options: pending.options, allow_multiple: pending.allow_multiple };
    question = pending.text;
  } else if (followUp) {
    reply = followUp;
    question = followUp.text;
  } else if (!changed && turn) {
    // Nothing extracted: show the model's clarification and keep the same buttons.
    reply = { text: turn.reply.trim() || pending.text, options: pending.options, allow_multiple: pending.allow_multiple };
    question = pending.text;
  } else {
    const next = nextQuestion(draft, ctx);
    reply = { ...next, text: [ack, note, next.text].filter(Boolean).join("\n\n") };
    question = next.text;
  }

  const now = new Date().toISOString();
  const messages: ChatMessage[] = [...conversation.messages, { role: "user", content: text, at: now }, promptToMessage(reply, question)];

  const { error } = await supabase
    .from("setup_conversations")
    .update({
      messages,
      extracted: draft,
      total_tokens: conversation.total_tokens + (usage?.totalTokens ?? 0),
      user_turns: conversation.user_turns + 1,
      updated_at: now,
    })
    .eq("id", conversation.id);
  if (error) throw error;

  // Bookkeeping doesn't need to hold up the reply.
  after(async () => {
    if (usage) await recordAiUsage(workspace.id, user.id, "setup_chat", usage);
    if (rejected.length) console.warn(`setup chat (${SETUP_PROMPT_VERSION}) rejected:`, rejected);
  });

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
