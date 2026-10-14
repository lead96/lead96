import "server-only";
import { publicEnv, serverEnv } from "@/lib/env";
import type { VoiceAgentConfig } from "./agent-config";
import type { RetellCall } from "./calls";
import type { SmsAgentConfig } from "./sms-config";

/** Lead96's Retell account (agency model): agents, phone numbers and calls for every business. */
const BASE = "https://api.retellai.com";

export class RetellError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Where Retell sends call events, tool calls and inbound-call lookups. Retell cannot reach
 * localhost, so local development uses the live site (same database).
 */
export function voiceWebhookBase() {
  const app = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return /localhost|127\.0\.0\.1/.test(app) ? "https://lead96.com" : app;
}

export function retellConfigured() {
  return Boolean(serverEnv().RETELL_API_KEY);
}

export async function retell<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const key = serverEnv().RETELL_API_KEY;
  if (!key) throw new RetellError(0, "RETELL_API_KEY is not set.");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page.
  }
  if (!res.ok) {
    const msg = (json as { error_message?: string; message?: string } | null)?.error_message ?? (json as { message?: string } | null)?.message ?? text.slice(0, 200);
    throw new RetellError(res.status, `Retell ${res.status}: ${msg || res.statusText}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Agents (one Retell LLM + one agent per business)
// ---------------------------------------------------------------------------

export type AgentIds = { llmId: string; agentId: string };

/** Our in-call tools (Retell calls them during the conversation; signed like the webhooks). */
function customTools(base: string) {
  return [
    {
      type: "custom",
      name: "check_availability",
      description: "Get the open visit windows for the next days. Call before offering any day or time.",
      url: `${base}/api/voice/tools/check_availability`,
      method: "POST",
      parameters: { type: "object", properties: {}, required: [] },
      speak_during_execution: true,
      execution_message_description: "Say you are checking the schedule.",
      speak_after_execution: true,
      timeout_ms: 8000,
    },
    {
      type: "custom",
      name: "book_appointment",
      description: "Save the visit window the caller chose (date, start and end exactly as check_availability returned them) and the service address.",
      url: `${base}/api/voice/tools/book_appointment`,
      method: "POST",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date of the chosen window, YYYY-MM-DD" },
          start: { type: "string", description: "Window start, HH:MM (24h)" },
          end: { type: "string", description: "Window end, HH:MM (24h)" },
          address: { type: "string", description: "Service address or ZIP code they confirmed" },
          notes: { type: "string", description: "Anything the technician should know, short" },
        },
        required: ["date", "start", "end"],
      },
      speak_during_execution: false,
      speak_after_execution: true,
      timeout_ms: 8000,
    },
  ];
}

function llmBody(c: VoiceAgentConfig, base: string) {
  const tools: Record<string, unknown>[] = [
    {
      type: "end_call",
      name: "end_call",
      description: "End the call when the conversation is finished, they asked not to be called, it is a wrong number, or you reached voicemail.",
    },
  ];
  tools.push(...customTools(base));
  if (c.transferPhone) {
    tools.push({
      type: "transfer_call",
      name: "transfer_to_team",
      description: "Transfer the caller to the business team when they ask for a person, or after giving safety advice in an emergency.",
      transfer_destination: { type: "predefined", number: c.transferPhone },
      transfer_option: {
        type: "warm_transfer",
        on_hold_music: "ringtone",
        private_handoff_option: {
          type: "prompt",
          prompt: "Briefly tell the team member who is calling, what they need and anything urgent, so they can take over.",
        },
      },
      speak_during_execution: true,
      execution_message_description: "Tell them you are connecting them with the team now.",
    });
  }
  return {
    model: serverEnv().RETELL_LLM_MODEL,
    model_temperature: 0.2,
    start_speaker: "agent",
    general_prompt: c.prompt,
    begin_message: c.beginMessage,
    default_dynamic_variables: c.dynamicDefaults,
    general_tools: tools,
  };
}

function agentBody(c: VoiceAgentConfig, llmId: string, webhookUrl: string) {
  return {
    agent_name: c.agentName,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: serverEnv().RETELL_VOICE_ID,
    language: "en-US",
    webhook_url: webhookUrl,
    webhook_events: ["call_started", "call_ended", "call_analyzed"],
    post_call_analysis_data: c.analysis,
    end_call_after_silence_ms: 20_000,
    max_call_duration_ms: 15 * 60_000,
    ring_duration_ms: 30_000,
    enable_dnc_detection: true,
    voicemail_option: { action: { type: "hangup" } },
    data_storage_setting: "everything",
  };
}

/** Creates the business's Retell LLM and agent, or updates them in place. */
export async function upsertAgent(c: VoiceAgentConfig, existing: Partial<AgentIds>, base: string): Promise<AgentIds> {
  const webhookUrl = `${base}/api/voice/retell`;
  const llm = existing.llmId
    ? await retell<{ llm_id: string }>("PATCH", `/update-retell-llm/${existing.llmId}`, llmBody(c, base))
    : await retell<{ llm_id: string }>("POST", "/create-retell-llm", llmBody(c, base));
  const body = agentBody(c, llm.llm_id, webhookUrl);
  const agent = existing.agentId
    ? await retell<{ agent_id: string }>("PATCH", `/update-agent/${existing.agentId}`, body)
    : await retell<{ agent_id: string }>("POST", "/create-agent", body);
  return { llmId: llm.llm_id, agentId: agent.agent_id };
}

/** A browser call to the agent (no phone number needed): returns the token the web SDK joins with. */
export async function createWebCall(agentId: string, variables: Record<string, string>, metadata: Record<string, string>) {
  return retell<{ call_id: string; access_token: string; transport?: "livekit" | "gateway"; url?: string; ice_servers?: RTCIceServer[] }>("POST", "/v3/create-web-call", {
    agent_id: agentId,
    retell_llm_dynamic_variables: variables,
    metadata,
  });
}

/** An outbound phone call from one of our numbers. The idempotency key makes a retried request call only once. */
export async function createPhoneCall(p: {
  from: string;
  to: string;
  agentId: string;
  variables: Record<string, string>;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) {
  return retell<RetellCall>("POST", "/v2/create-phone-call", {
    from_number: p.from,
    to_number: p.to,
    override_agent_id: p.agentId,
    retell_llm_dynamic_variables: p.variables,
    metadata: p.metadata,
    idempotency_key: p.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 255),
  });
}

export async function getCall(callId: string) {
  return retell<RetellCall>("GET", `/v2/get-call/${encodeURIComponent(callId)}`);
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export type RetellNumber = {
  phone_number: string;
  phone_number_pretty?: string;
  phone_number_type: string;
  area_code?: number;
  nickname?: string | null;
  inbound_agents?: { agent_id: string; weight: number }[] | null;
  outbound_agents?: { agent_id: string; weight: number }[] | null;
  inbound_webhook_url?: string | null;
};

export async function listNumbers(): Promise<RetellNumber[]> {
  const r = await retell<RetellNumber[] | { items?: RetellNumber[]; phone_numbers?: RetellNumber[] }>("GET", "/v2/list-phone-numbers");
  return Array.isArray(r) ? r : (r.items ?? r.phone_numbers ?? []);
}

/** Buys a US number in the Lead96 Retell account (billed monthly to the card on that account). */
export async function buyNumber(opts: { areaCode?: number; nickname?: string }): Promise<RetellNumber> {
  return retell<RetellNumber>("POST", "/create-phone-number", {
    country_code: "US",
    ...(opts.areaCode ? { area_code: opts.areaCode } : {}),
    ...(opts.nickname ? { nickname: opts.nickname.slice(0, 100) } : {}),
    allowed_outbound_country_list: ["US", "CA"],
  });
}

/**
 * Points a number at a business's agent (or detaches it with agentId = null). Incoming calls ask
 * our inbound webhook first, so a known caller is greeted by name.
 */
export async function bindNumber(
  e164: string,
  agentId: string | null,
  opts: { nickname?: string; smsAgentId?: string | null } = {},
): Promise<{ number: RetellNumber; smsLinked: boolean }> {
  const agents = agentId ? [{ agent_id: agentId, weight: 1 }] : [];
  const path = `/update-phone-number/${encodeURIComponent(e164)}`;
  const voice = {
    inbound_agents: agents,
    outbound_agents: agents,
    inbound_webhook_url: agentId ? `${voiceWebhookBase()}/api/voice/inbound` : null,
    ...(opts.nickname !== undefined ? { nickname: opts.nickname.slice(0, 100) } : {}),
  };
  // Texting can only be linked once the number has US SMS registration (an "A2P application" in
  // Retell); any SMS field before that fails the whole update. Calls are linked either way.
  if (!agentId || !opts.smsAgentId) return { number: await retell<RetellNumber>("PATCH", path, voice), smsLinked: false };
  const sms = [{ agent_id: opts.smsAgentId, weight: 1 }];
  try {
    return { number: await retell<RetellNumber>("PATCH", path, { ...voice, inbound_sms_agents: sms, outbound_sms_agents: sms }), smsLinked: true };
  } catch (e) {
    if (!(e instanceof RetellError) || !/a2p/i.test(e.message)) throw e;
    return { number: await retell<RetellNumber>("PATCH", path, voice), smsLinked: false };
  }
}

// ---------------------------------------------------------------------------
// Texts (Retell SMS chat agent per business)
// ---------------------------------------------------------------------------

export type RetellChat = {
  chat_id: string;
  agent_id?: string;
  chat_status: "ongoing" | "ended" | "error";
  chat_type?: string;
  metadata?: unknown;
  start_timestamp?: number;
  end_timestamp?: number | null;
  message_with_tool_calls?: { role: string; content?: string }[];
  transcript?: string;
  chat_analysis?: { chat_summary?: string; user_sentiment?: string; chat_successful?: boolean; custom_analysis_data?: unknown };
};

/** Creates the business's text LLM and chat agent, or updates them in place. */
export async function upsertSmsAgent(c: SmsAgentConfig, existing: Partial<AgentIds>, base: string): Promise<AgentIds> {
  const llmBody = {
    model: serverEnv().RETELL_LLM_MODEL,
    model_temperature: 0.2,
    start_speaker: "agent",
    general_prompt: c.prompt,
    begin_message: c.beginMessage,
    default_dynamic_variables: c.dynamicDefaults,
    general_tools: [{ type: "end_call", name: "end_chat", description: "End the conversation when it is finished or they asked to stop." }],
  };
  const llm = existing.llmId
    ? await retell<{ llm_id: string }>("PATCH", `/update-retell-llm/${existing.llmId}`, llmBody)
    : await retell<{ llm_id: string }>("POST", "/create-retell-llm", llmBody);
  const agentBody = {
    agent_name: c.agentName,
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    language: "en-US",
    webhook_url: `${base}/api/voice/retell`,
    webhook_events: ["chat_started", "chat_ended", "chat_analyzed"],
    post_chat_analysis_data: c.analysis,
    end_chat_after_silence_ms: 24 * 3_600_000,
    data_storage_setting: "everything",
  };
  const agent = existing.agentId
    ? await retell<{ agent_id: string }>("PATCH", `/update-chat-agent/${existing.agentId}`, agentBody)
    : await retell<{ agent_id: string }>("POST", "/create-chat-agent", agentBody);
  return { llmId: llm.llm_id, agentId: agent.agent_id };
}

/** Starts a text conversation; the first text is the {{sms_opening}} we pass. */
export async function createSmsChat(p: { from: string; to: string; agentId: string; variables: Record<string, string>; metadata: Record<string, string> }) {
  return retell<RetellChat>("POST", "/create-sms-chat", {
    from_number: p.from,
    to_number: p.to,
    override_agent_id: p.agentId,
    retell_llm_dynamic_variables: p.variables,
    metadata: p.metadata,
    honor_internal_dnc: true,
  });
}
