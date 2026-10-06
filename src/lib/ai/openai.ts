import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

export class AiUnavailableError extends Error {}

let client: OpenAI | null = null;
function getClient() {
  const { OPENAI_API_KEY } = serverEnv();
  if (!OPENAI_API_KEY) throw new AiUnavailableError("OPENAI_API_KEY is not set");
  client ??= new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  return client;
}

export type Usage = { model: string; inputTokens: number; outputTokens: number; totalTokens: number };

type Message = { role: "user" | "assistant"; content: string };

/**
 * One structured-output call. The model must answer with JSON matching `schema`
 * (strict mode); `store: false` keeps prompts and outputs out of OpenAI's storage.
 */
export async function structuredCompletion<T>(opts: {
  name: string;
  schema: object;
  instructions: string;
  input: Message[];
  maxOutputTokens?: number;
}): Promise<{ data: T; usage: Usage }> {
  const model = serverEnv().OPENAI_MODEL;
  let response;
  try {
    response = await getClient().responses.create({
      model,
      instructions: opts.instructions,
      input: opts.input,
      store: false,
      max_output_tokens: opts.maxOutputTokens ?? 1200,
      text: { format: { type: "json_schema", name: opts.name, strict: true, schema: opts.schema as Record<string, unknown> } },
    });
  } catch (e) {
    console.error(`OpenAI ${opts.name} failed:`, e instanceof Error ? e.message : e);
    throw new AiUnavailableError("The AI service did not respond");
  }

  const usage: Usage = {
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
  if (response.status === "incomplete" || !response.output_text) {
    console.error(`OpenAI ${opts.name} incomplete:`, response.incomplete_details);
    throw new AiUnavailableError("The AI reply was cut off");
  }
  return { data: JSON.parse(response.output_text) as T, usage };
}

/** Record AI usage for a workspace (basis for credits later). Never fails the caller. */
export async function recordAiUsage(workspaceId: string, actorId: string | null, feature: string, usage: Usage) {
  const { error } = await createAdminClient().from("usage_records").insert({
    workspace_id: workspaceId,
    actor_id: actorId,
    kind: "ai_tokens",
    feature,
    quantity: usage.totalTokens,
    model: usage.model,
    metadata: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  });
  if (error) console.error("recordAiUsage failed:", error.message);
}
