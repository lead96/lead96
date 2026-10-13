import "server-only";
import { serverEnv } from "@/lib/env";

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

/** Points a number at a business's agent (or detaches it with agentId = null). */
export async function bindNumber(e164: string, agentId: string | null, opts: { nickname?: string } = {}) {
  const agents = agentId ? [{ agent_id: agentId, weight: 1 }] : [];
  return retell<RetellNumber>("PATCH", `/update-phone-number/${encodeURIComponent(e164)}`, {
    inbound_agents: agents,
    outbound_agents: agents,
    ...(opts.nickname !== undefined ? { nickname: opts.nickname.slice(0, 100) } : {}),
  });
}
