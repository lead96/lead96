/**
 * Tenant isolation tests against the linked dev Supabase project.
 * Creates throwaway users, checks that RLS keeps workspaces apart, then deletes them.
 * Skipped when Supabase env vars are missing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

const run = Date.now().toString(36);
const password = `Test-${run}-pw!`;

type TestUser = { id: string; email: string; client: SupabaseClient };

async function makeUser(admin: SupabaseClient, label: string): Promise<TestUser> {
  const email = `rls-${label}-${run}@test.leadgen.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

describe.skipIf(!configured)("row-level security", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser;
  let ownerB: TestUser;
  let staffA: TestUser;
  let wsA: string;
  let wsB: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    [ownerA, ownerB, staffA] = await Promise.all([
      makeUser(admin, "owner-a"),
      makeUser(admin, "owner-b"),
      makeUser(admin, "staff-a"),
    ]);

    const a = await ownerA.client.rpc("create_workspace", { p_name: `A ${run}` });
    const b = await ownerB.client.rpc("create_workspace", { p_name: `B ${run}` });
    if (a.error || b.error) throw a.error ?? b.error;
    wsA = a.data;
    wsB = b.data;

    // Invite staffA into workspace A through the real invite flow.
    const invite = await ownerA.client
      .from("workspace_invites")
      .insert({ workspace_id: wsA, email: staffA.email, role: "staff" })
      .select("token")
      .single();
    if (invite.error) throw invite.error;
    const accepted = await staffA.client.rpc("accept_invite", { p_token: invite.data.token });
    if (accepted.error) throw accepted.error;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("workspaces").delete().in("id", [wsA, wsB].filter(Boolean));
    const results = await Promise.all(
      [ownerA, ownerB, staffA].filter(Boolean).map((u) => admin.auth.admin.deleteUser(u.id)),
    );
    // "User not found" is fine: a test may already have deleted that user.
    const failed = results.filter((r) => r.error && !/not.?found/i.test(r.error.message));
    if (failed.length) throw new Error(`test user cleanup failed: ${failed[0].error!.message}`);
  });

  it("create_workspace seeds owner, demand profile and HVAC questions", async () => {
    const { data: settings } = await ownerA.client.from("agent_settings").select("questions").eq("workspace_id", wsA).single();
    expect(Array.isArray(settings?.questions)).toBe(true);
    expect((settings?.questions as unknown[]).length).toBeGreaterThan(0);

    const { data: profile } = await ownerA.client.from("demand_profiles").select("workspace_id").eq("workspace_id", wsA).single();
    expect(profile?.workspace_id).toBe(wsA);
  });

  it("a user cannot see another business's workspace or data", async () => {
    const tables = ["workspaces", "demand_profiles", "agent_settings", "events", "workspace_members"] as const;
    for (const table of tables) {
      const column = table === "workspaces" ? "id" : "workspace_id";
      const { data, error } = await ownerB.client.from(table).select("*").eq(column, wsA);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it("a user cannot write into another business's workspace", async () => {
    await ownerB.client.from("demand_profiles").update({ capacity_per_day: 99 }).eq("workspace_id", wsA);
    const { data } = await ownerA.client.from("demand_profiles").select("capacity_per_day").eq("workspace_id", wsA).single();
    expect(data?.capacity_per_day).not.toBe(99);

    const insert = await ownerB.client
      .from("events")
      .insert({ workspace_id: wsA, type: "test.intrusion", actor_id: ownerB.id });
    expect(insert.error).not.toBeNull();
  });

  it("staff can read but not change business settings", async () => {
    const read = await staffA.client.from("demand_profiles").select("workspace_id").eq("workspace_id", wsA);
    expect(read.data).toHaveLength(1);

    await staffA.client.from("demand_profiles").update({ capacity_per_day: 42 }).eq("workspace_id", wsA);
    const { data } = await ownerA.client.from("demand_profiles").select("capacity_per_day").eq("workspace_id", wsA).single();
    expect(data?.capacity_per_day).not.toBe(42);
  });

  it("events are append-only", async () => {
    const inserted = await ownerA.client
      .from("events")
      .insert({ workspace_id: wsA, type: "test.event", actor_id: ownerA.id })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    await ownerA.client.from("events").update({ type: "tampered" }).eq("id", inserted.data!.id);
    await ownerA.client.from("events").delete().eq("id", inserted.data!.id);
    const { data } = await ownerA.client.from("events").select("type").eq("id", inserted.data!.id).single();
    expect(data?.type).toBe("test.event");
  });

  it("users cannot make themselves platform admin", async () => {
    await ownerA.client.from("profiles").update({ is_platform_admin: true }).eq("id", ownerA.id);
    const { data } = await admin.from("profiles").select("is_platform_admin").eq("id", ownerA.id).single();
    expect(data?.is_platform_admin).toBe(false);
  });

  it("an invite cannot be accepted by a different email", async () => {
    const invite = await ownerA.client
      .from("workspace_invites")
      .insert({ workspace_id: wsA, email: `someone-else-${run}@test.leadgen.invalid` })
      .select("token")
      .single();
    const res = await ownerB.client.rpc("accept_invite", { p_token: invite.data!.token });
    expect(res.error?.message).toContain("email_mismatch");
  });

  it("invite preview works signed out but reveals nothing without the token", async () => {
    const invite = await ownerA.client
      .from("workspace_invites")
      .insert({ workspace_id: wsA, email: `preview-${run}@test.leadgen.invalid` })
      .select("token")
      .single();
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });

    const { data } = await anon.rpc("get_invite", { p_token: invite.data!.token });
    expect(data).toEqual([
      expect.objectContaining({ workspace_name: `A ${run}`, status: "valid", already_member: false }),
    ]);
    expect((await anon.rpc("get_invite", { p_token: "not-a-real-token" })).data).toEqual([]);
    // Signed-out callers cannot accept, and cannot list invites.
    expect((await anon.rpc("accept_invite", { p_token: invite.data!.token })).error).not.toBeNull();
    expect((await anon.from("workspace_invites").select("id")).data).toEqual([]);
  });

  it("re-opening a used invite is harmless for the member and refused for others", async () => {
    const { data: used } = await admin
      .from("workspace_invites")
      .select("token")
      .eq("workspace_id", wsA)
      .eq("email", staffA.email)
      .single();
    const again = await staffA.client.rpc("accept_invite", { p_token: used!.token });
    expect(again.data).toBe(wsA);
    const other = await ownerB.client.rpc("accept_invite", { p_token: used!.token });
    expect(other.error?.message).toContain("invite_used");
  });

  it("pending invites are listed only for the invited email", async () => {
    const invite = await ownerB.client
      .from("workspace_invites")
      .insert({ workspace_id: wsB, email: staffA.email.toUpperCase() })
      .select("token")
      .single();
    const mine = await staffA.client.rpc("my_pending_invites");
    expect(mine.data).toEqual([expect.objectContaining({ token: invite.data!.token, workspace_name: `B ${run}` })]);
    const others = await ownerA.client.rpc("my_pending_invites");
    expect(others.data).toEqual([]);
  });

  it("an expired invite cannot be accepted", async () => {
    const invite = await ownerB.client
      .from("workspace_invites")
      .insert({ workspace_id: wsB, email: staffA.email, expires_at: new Date(Date.now() - 1000).toISOString() })
      .select("token")
      .single();
    const res = await staffA.client.rpc("accept_invite", { p_token: invite.data!.token });
    expect(res.error?.message).toContain("invite_expired");
  });

  // Keep last: removes staffA.
  it("a user with history can be deleted; audit rows remain without the link", async () => {
    const { error } = await admin.auth.admin.deleteUser(staffA.id);
    expect(error).toBeNull();

    const { data: membership } = await admin.from("workspace_members").select("user_id").eq("user_id", staffA.id);
    expect(membership).toEqual([]);
    const { data: audit } = await admin
      .from("audit_log")
      .select("actor_id")
      .eq("workspace_id", wsA)
      .eq("action", "invite.accept");
    expect(audit).toHaveLength(1);
    expect(audit![0].actor_id).toBeNull();
  });
});
