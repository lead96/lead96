/**
 * Readable change history rows (change_log). Pure - unit-tested.
 */

export const TABLE_LABELS: Record<string, string> = {
  workspaces: "Business",
  workspace_members: "Team member",
  workspace_invites: "Invite",
  customers: "Customer",
  leads: "Lead",
  calls: "Call",
  messages: "Text",
  landing_pages: "Landing page",
  demand_profiles: "Setup (demand)",
  agent_settings: "Setup (AI questions)",
  voice_agents: "AI caller",
  phone_numbers: "Phone number",
  ad_accounts: "Ad account",
  profiles: "User",
};

export const ACTION_LABELS: Record<string, string> = { insert: "Created", update: "Changed", delete: "Deleted" };

const MAX = 80;

/** One value as short text: strings as they are, objects as compact JSON, long values cut. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX ? `${s.slice(0, MAX - 3)}...` : s;
}

export type FieldChange = { field: string; from: string; to: string };

/** What changed in one update (only the changed fields are stored). */
export function fieldChanges(row: { changed_fields: string[] | null; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null }): FieldChange[] {
  return (row.changed_fields ?? []).map((f) => ({ field: f.replaceAll("_", " "), from: showValue(row.old_values?.[f]), to: showValue(row.new_values?.[f]) }));
}

/** A short name for the row, taken from its values (customer name, page name, number...). */
export function rowLabel(table: string, values: Record<string, unknown> | null): string | null {
  const v = values ?? {};
  const pick = (...keys: string[]) => keys.map((k) => v[k]).find((x) => typeof x === "string" && x.trim()) as string | undefined;
  switch (table) {
    case "customers":
    case "leads":
      return pick("full_name", "phone", "email") ?? null;
    case "landing_pages":
      return pick("name", "slug") ?? null;
    case "workspaces":
      return pick("name") ?? null;
    case "phone_numbers":
      return pick("e164") ?? null;
    case "workspace_invites":
    case "profiles":
      return pick("email") ?? null;
    case "calls":
      return pick("outcome", "status") ?? null;
    default:
      return null;
  }
}
