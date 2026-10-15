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

  it("usage records: server-written only; visible to the owner, not staff or other businesses", async () => {
    const seeded = await admin
      .from("usage_records")
      .insert({ workspace_id: wsA, kind: "ai_tokens", feature: "test", quantity: 123 })
      .select("id")
      .single();
    expect(seeded.error).toBeNull();

    expect((await ownerA.client.from("usage_records").select("quantity").eq("workspace_id", wsA)).data).toEqual([{ quantity: 123 }]);
    expect((await staffA.client.from("usage_records").select("id").eq("workspace_id", wsA)).data).toEqual([]);
    expect((await ownerB.client.from("usage_records").select("id").eq("workspace_id", wsA)).data).toEqual([]);

    // Nobody can write usage from the browser (it will drive billing).
    const forged = await ownerA.client.from("usage_records").insert({ workspace_id: wsA, kind: "ai_tokens", feature: "x", quantity: -999 });
    expect(forged.error).not.toBeNull();
    await ownerA.client.from("usage_records").delete().eq("id", seeded.data!.id);
    expect((await admin.from("usage_records").select("id").eq("id", seeded.data!.id)).data).toHaveLength(1);
  });

  it("webhook deliveries: server-written only; visible to the owner, not staff or other businesses", async () => {
    const seeded = await admin
      .from("webhook_deliveries")
      .insert({ provider: "call", external_id: `rls-${run}`, workspace_id: wsA, status: "processed", payload: { test: true } })
      .select("id")
      .single();
    expect(seeded.error).toBeNull();

    expect((await ownerA.client.from("webhook_deliveries").select("status").eq("id", seeded.data!.id)).data).toEqual([{ status: "processed" }]);
    expect((await staffA.client.from("webhook_deliveries").select("id").eq("id", seeded.data!.id)).data).toEqual([]);
    expect((await ownerB.client.from("webhook_deliveries").select("id").eq("id", seeded.data!.id)).data).toEqual([]);

    const forged = await ownerA.client.from("webhook_deliveries").insert({ provider: "call", workspace_id: wsA, status: "processed" });
    expect(forged.error).not.toBeNull();
    await ownerA.client.from("webhook_deliveries").delete().eq("id", seeded.data!.id);
    expect((await admin.from("webhook_deliveries").select("id").eq("id", seeded.data!.id)).data).toHaveLength(1);
  });

  it("integration health: platform admins only, and it counts real deliveries", async () => {
    expect((await ownerA.client.rpc("admin_integration_health")).error).not.toBeNull();
    expect((await staffA.client.rpc("admin_integration_health")).error).not.toBeNull();

    const seeded = await admin.from("webhook_deliveries").insert(
      [
        { provider: "call", external_id: `h1-${run}`, workspace_id: wsA, status: "processed" },
        { provider: "call", external_id: `h1-${run}`, workspace_id: wsA, status: "duplicate", attempt: 2 },
        { provider: "call", external_id: `h2-${run}`, workspace_id: wsA, status: "failed", error: "db down" },
        { provider: "call", external_id: `h3-${run}`, workspace_id: wsA, status: "rejected", error: "no caller number or email" },
      ],
      { defaultToNull: false }, // rows without "attempt" get the column default, not null
    );
    expect(seeded.error).toBeNull();
    const platform = await makeUser(admin, "platform");
    try {
      await admin.from("profiles").update({ is_platform_admin: true }).eq("id", platform.id);
      const { data, error } = await platform.client.rpc("admin_integration_health");
      expect(error).toBeNull();
      const call = data.deliveries.call;
      // Other tests may have left deliveries too; ours must be counted.
      expect(call.ok_24h).toBeGreaterThanOrEqual(2);
      expect(call.failed_24h).toBeGreaterThanOrEqual(1);
      expect(call.retries_7d).toBeGreaterThanOrEqual(1);
      expect(call.no_contact_7d).toBeGreaterThanOrEqual(1);
      const a = data.workspaces.find((w: { id: string }) => w.id === wsA);
      expect(a).toMatchObject({ problems_7d: 1 }); // the blocked caller ID is not a problem
      expect(data.workspaces.some((w: { id: string }) => w.id === wsB)).toBe(true);
    } finally {
      await admin.auth.admin.deleteUser(platform.id);
    }
  });

  it("ad accounts, spend and platform sign-ins: members read their own, keys and sign-ins stay server-side", async () => {
    const acct = await admin
      .from("ad_accounts")
      .insert({ workspace_id: wsA, platform: "google", external_id: `99${Date.now()}`, name: "Test account" })
      .select("id, webhook_key")
      .single();
    expect(acct.error).toBeNull();
    expect(acct.data!.webhook_key).toMatch(/^[0-9a-f]{48}$/);
    const spend = await admin
      .from("ad_spend_daily")
      .insert({ workspace_id: wsA, platform: "google", account_external_id: "1", campaign_id: `c-${run}`, date: "2026-10-01", cost: 12.5 })
      .select("id")
      .single();
    expect(spend.error).toBeNull();

    expect((await staffA.client.from("ad_accounts").select("id, name").eq("id", acct.data!.id)).data).toHaveLength(1);
    // The webhook key column is not readable by anyone signed in, not even the owner.
    expect((await ownerA.client.from("ad_accounts").select("webhook_key").eq("id", acct.data!.id)).error).not.toBeNull();
    expect((await ownerA.client.from("ad_accounts").select("*").eq("id", acct.data!.id)).error).not.toBeNull();
    expect((await ownerB.client.from("ad_accounts").select("id").eq("id", acct.data!.id)).data).toEqual([]);
    expect((await ownerA.client.from("ad_accounts").insert({ workspace_id: wsA, platform: "google", external_id: "1" })).error).not.toBeNull();

    expect((await staffA.client.from("ad_spend_daily").select("cost").eq("id", spend.data!.id)).data).toEqual([{ cost: 12.5 }]);
    expect((await ownerB.client.from("ad_spend_daily").select("id").eq("id", spend.data!.id)).data).toEqual([]);
    expect((await ownerA.client.from("ad_spend_daily").insert({ workspace_id: wsA, platform: "google", account_external_id: "1", campaign_id: "x", date: "2026-10-02" })).error).not.toBeNull();

    // Platform sign-ins: no client role can read or write them.
    expect((await ownerA.client.from("platform_connections").select("*")).data ?? []).toEqual([]);
    expect((await ownerA.client.from("platform_connections").insert({ provider: "meta", secret_ciphertext: "x" })).error).not.toBeNull();
  });

  it("voice: agents, numbers and calls are read by members, written by the server; owners switch auto-call", async () => {
    expect((await admin.from("voice_agents").insert({ workspace_id: wsA, retell_agent_id: `agent_${run}`, version: 1 })).error).toBeNull();
    const ver = await admin.from("voice_agent_versions").insert({ workspace_id: wsA, version: 1, config: { prompt: "x" } });
    expect(ver.error).toBeNull();
    const num = await admin.from("phone_numbers").insert({ workspace_id: wsA, e164: `+1555${String(Date.now()).slice(-7)}` }).select("id").single();
    expect(num.error).toBeNull();
    const call = await admin
      .from("calls")
      .insert({ workspace_id: wsA, direction: "outbound", trigger: "test", provider_call_id: `call_${run}`, status: "ended", outcome: "qualified" })
      .select("id")
      .single();
    expect(call.error).toBeNull();

    // Members read their own business's voice data; other businesses see nothing.
    expect((await staffA.client.from("voice_agents").select("auto_call").eq("workspace_id", wsA)).data).toEqual([{ auto_call: false }]);
    expect((await staffA.client.from("calls").select("outcome").eq("id", call.data!.id)).data).toEqual([{ outcome: "qualified" }]);
    expect((await staffA.client.from("phone_numbers").select("id").eq("id", num.data!.id)).data).toHaveLength(1);
    expect((await ownerB.client.from("calls").select("id").eq("id", call.data!.id)).data).toEqual([]);
    expect((await ownerB.client.from("voice_agents").select("workspace_id").eq("workspace_id", wsA)).data).toEqual([]);
    expect((await ownerB.client.from("phone_numbers").select("id").eq("id", num.data!.id)).data).toEqual([]);
    // Prompt versions: owners only.
    expect((await ownerA.client.from("voice_agent_versions").select("version").eq("workspace_id", wsA)).data).toEqual([{ version: 1 }]);
    expect((await staffA.client.from("voice_agent_versions").select("version").eq("workspace_id", wsA)).data).toEqual([]);

    // Nobody signed in can write calls, numbers or agents directly.
    expect((await ownerA.client.from("calls").insert({ workspace_id: wsA, direction: "inbound", trigger: "inbound" })).error).not.toBeNull();
    expect((await ownerA.client.from("phone_numbers").insert({ workspace_id: wsA, e164: "+15550000000" })).error).not.toBeNull();
    await ownerA.client.from("voice_agents").update({ auto_call: true }).eq("workspace_id", wsA);
    expect((await admin.from("voice_agents").select("auto_call").eq("workspace_id", wsA).single()).data!.auto_call).toBe(false);

    // The owner switch goes through set_auto_call(): owners yes, staff and other businesses no.
    expect((await staffA.client.rpc("set_auto_call", { p_workspace: wsA, p_on: true })).error).not.toBeNull();
    expect((await ownerB.client.rpc("set_auto_call", { p_workspace: wsA, p_on: true })).error).not.toBeNull();
    expect((await ownerA.client.rpc("set_auto_call", { p_workspace: wsA, p_on: true })).error).toBeNull();
    expect((await admin.from("voice_agents").select("auto_call").eq("workspace_id", wsA).single()).data!.auto_call).toBe(true);

    // Review: any member (staff too) marks a call reviewed / corrects the outcome; other businesses cannot.
    await admin.from("calls").update({ needs_review: true }).eq("id", call.data!.id);
    expect((await ownerB.client.rpc("review_call", { p_call: call.data!.id, p_outcome: "booked" })).error).not.toBeNull();
    expect((await staffA.client.rpc("review_call", { p_call: call.data!.id, p_outcome: "made_up" })).error).not.toBeNull();
    expect((await staffA.client.rpc("review_call", { p_call: call.data!.id, p_outcome: "booked" })).error).toBeNull();
    const reviewed = (await admin.from("calls").select("outcome, original_outcome, needs_review, reviewed_by").eq("id", call.data!.id).single()).data!;
    expect(reviewed).toEqual({ outcome: "booked", original_outcome: "qualified", needs_review: false, reviewed_by: staffA.id });
    // Direct edits stay impossible.
    await ownerA.client.from("calls").update({ outcome: "other" }).eq("id", call.data!.id);
    expect((await admin.from("calls").select("outcome").eq("id", call.data!.id).single()).data!.outcome).toBe("booked");

    // Customers can be marked do-not-call only by the server.
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "DNC Test" }).select("id").single();
    await ownerA.client.from("customers").update({ do_not_call: true }).eq("id", cust.data!.id);
    expect((await admin.from("customers").select("do_not_call").eq("id", cust.data!.id).single()).data!.do_not_call).toBe(false);

    await admin.from("phone_numbers").delete().eq("id", num.data!.id);
  }, 120_000);

  it("call jobs: members read, nobody signed in can queue or claim calls", async () => {
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Job Test", phone: `+1214555${String(Date.now()).slice(-4)}` }).select("id").single();
    const job = await admin
      .from("call_jobs")
      .insert({ workspace_id: wsA, customer_id: cust.data!.id, trigger: "fast_callback", run_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id")
      .single();
    expect(job.error).toBeNull();
    // One open job per customer: a second queued job for the same person is refused.
    expect((await admin.from("call_jobs").insert({ workspace_id: wsA, customer_id: cust.data!.id, trigger: "retry", attempt: 2 })).error).not.toBeNull();

    expect((await staffA.client.from("call_jobs").select("status").eq("id", job.data!.id)).data).toEqual([{ status: "queued" }]);
    expect((await ownerB.client.from("call_jobs").select("id").eq("id", job.data!.id)).data).toEqual([]);
    expect((await ownerA.client.from("call_jobs").insert({ workspace_id: wsA, customer_id: cust.data!.id, trigger: "manual" })).error).not.toBeNull();
    expect((await ownerA.client.rpc("claim_call_jobs", { p_limit: 5 })).error).not.toBeNull();
    expect((await ownerA.client.rpc("call_runner_tick")).error).not.toBeNull();

    await admin.from("call_jobs").delete().eq("id", job.data!.id);
  }, 120_000);

  it("text messages: members read, nobody signed in writes", async () => {
    const msg = await admin.from("messages").insert({ workspace_id: wsA, reason: "no_answer", status: "sent", body: "Hi" }).select("id").single();
    expect(msg.error).toBeNull();
    expect((await staffA.client.from("messages").select("body").eq("id", msg.data!.id)).data).toEqual([{ body: "Hi" }]);
    expect((await ownerB.client.from("messages").select("id").eq("id", msg.data!.id)).data).toEqual([]);
    expect((await ownerA.client.from("messages").insert({ workspace_id: wsA, reason: "manual" })).error).not.toBeNull();
    await ownerA.client.from("messages").update({ body: "changed" }).eq("id", msg.data!.id);
    expect((await admin.from("messages").select("body").eq("id", msg.data!.id).single()).data!.body).toBe("Hi");
  }, 120_000);

  it("change history: every change logged with who and old/new values; owners read, nobody edits", async () => {
    // A user change (through the owner's own RPC) is recorded with their id and only the changed fields.
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "History Test", phone: `+1214777${String(Date.now()).slice(-4)}` }).select("id").single();
    expect((await ownerA.client.rpc("set_customer_status", { p_customer: cust.data!.id, p_status: "contacted", p_reason: "test" })).error).toBeNull();
    const rows = (await admin.from("change_log").select("action, via, actor_id, changed_fields, old_values, new_values").eq("table_name", "customers").eq("row_id", cust.data!.id).order("id")).data!;
    expect(rows[0]).toMatchObject({ action: "insert", via: "system", actor_id: null });
    expect(rows[1]).toMatchObject({ action: "update", via: "user", actor_id: ownerA.id, changed_fields: ["status"], old_values: { status: "new" }, new_values: { status: "contacted" } });

    // Secrets are never copied into the history.
    const inv = await admin.from("workspace_invites").insert({ workspace_id: wsA, email: `hist-${run}@test.leadgen.invalid` }).select("id, token").single();
    const invLog = (await admin.from("change_log").select("new_values").eq("table_name", "workspace_invites").eq("row_id", inv.data!.id).single()).data!;
    expect(invLog.new_values).not.toHaveProperty("token");
    expect(JSON.stringify(invLog)).not.toContain(inv.data!.token);

    // Owners read their business's history; staff and other businesses do not.
    expect((await ownerA.client.from("change_log").select("id").eq("row_id", cust.data!.id)).data!.length).toBeGreaterThanOrEqual(2);
    expect((await staffA.client.from("change_log").select("id").eq("row_id", cust.data!.id)).data).toEqual([]);
    expect((await ownerB.client.from("change_log").select("id").eq("row_id", cust.data!.id)).data).toEqual([]);

    // Append-only: nobody can write, change or remove history, not even the server.
    expect((await ownerA.client.from("change_log").insert({ table_name: "x", row_id: "x", action: "insert", via: "user" })).error).not.toBeNull();
    const first = (await admin.from("change_log").select("id").eq("row_id", cust.data!.id).order("id").limit(1).single()).data!;
    expect((await admin.from("change_log").update({ action: "delete" }).eq("id", first.id)).error).not.toBeNull();
    expect((await admin.from("change_log").delete().eq("id", first.id)).error).not.toBeNull();

    // Deleting a row keeps a record of what it was.
    await admin.from("workspace_invites").delete().eq("id", inv.data!.id);
    const del = (await admin.from("change_log").select("action, old_values").eq("table_name", "workspace_invites").eq("row_id", inv.data!.id).eq("action", "delete").single()).data!;
    expect(del.old_values).toMatchObject({ email: `hist-${run}@test.leadgen.invalid` });
  }, 120_000);

  it("calendar: members book through the function, capacity holds under parallel bookings, owners block days", async () => {
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const starts = `${day}T13:00:00.000Z`;
    const ends = `${day}T17:00:00.000Z`;
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Cal Test", phone: `+1214666${String(Date.now()).slice(-4)}` }).select("id").single();
    const book = (client: typeof admin, cap = 1, dayCap = 5) =>
      client.rpc("book_window", { p_workspace: wsA, p_starts: starts, p_ends: ends, p_window_cap: cap, p_day_cap: dayCap, p_tz: "America/Chicago", p_customer: cust.data!.id, p_source: "manual" });

    // Direct writes are not possible; other businesses cannot book here.
    expect((await ownerA.client.from("appointments").insert({ workspace_id: wsA, starts_at: starts, ends_at: ends, source: "manual" })).error).not.toBeNull();
    expect((await book(ownerB.client)).error).not.toBeNull();

    // Staff books; the customer moves to "appointment"; the window (capacity 1) is then full.
    const first = await book(staffA.client);
    expect(first.error).toBeNull();
    expect((await admin.from("customers").select("status").eq("id", cust.data!.id).single()).data!.status).toBe("appointment");
    expect((await book(staffA.client)).error?.message).toBe("full");
    expect((await staffA.client.from("appointments").select("id").eq("id", first.data)).data).toHaveLength(1);
    expect((await ownerB.client.from("appointments").select("id").eq("id", first.data)).data).toEqual([]);

    // Concurrency: 5 parallel bookings for the last place in a capacity-2 window -> exactly one wins.
    const parallel = await Promise.all(Array.from({ length: 5 }, () => book(admin, 2)));
    expect(parallel.filter((r) => !r.error).length).toBe(1);
    expect(parallel.filter((r) => r.error?.message === "full").length).toBe(4);

    // Cancelling frees the place; staff cannot block days, owners can, and blocked days refuse bookings.
    expect((await staffA.client.rpc("set_appointment_status", { p_id: first.data, p_status: "cancelled", p_reason: "test" })).error).toBeNull();
    expect((await staffA.client.from("calendar_blackouts").insert({ workspace_id: wsA, starts_on: day, ends_on: day })).error).not.toBeNull();
    expect((await ownerA.client.from("calendar_blackouts").insert({ workspace_id: wsA, starts_on: day, ends_on: day })).error).toBeNull();
    expect((await book(staffA.client, 5)).error?.message).toBe("blocked");

    await admin.from("calendar_blackouts").delete().eq("workspace_id", wsA);
    await admin.from("appointments").delete().eq("workspace_id", wsA);
  }, 120_000);

  it("visit messages: planned on booking, replaced on move, dropped on cancel; members read, only the server claims", async () => {
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const starts = `${day}T13:00:00.000Z`;
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Note Test", phone: `+1214555${String(Date.now()).slice(-4)}` }).select("id").single();
    const appt = await admin.rpc("book_window", { p_workspace: wsA, p_starts: starts, p_ends: `${day}T17:00:00.000Z`, p_window_cap: 5, p_day_cap: 5, p_tz: "America/Chicago", p_customer: cust.data!.id, p_source: "manual" });
    expect(appt.error).toBeNull();
    const jobs = async () => (await admin.from("notification_jobs").select("kind, status, run_at").eq("appointment_id", appt.data).order("created_at")).data!;
    let j = await jobs();
    expect(j.map((x) => x.kind).sort()).toEqual(["confirmation", "reminder_24h", "reminder_2h", "team_new_booking"]);
    expect(Date.parse(j.find((x) => x.kind === "reminder_24h")!.run_at)).toBe(Date.parse(starts) - 24 * 3_600_000);
    expect(Date.parse(j.find((x) => x.kind === "reminder_2h")!.run_at)).toBe(Date.parse(starts) - 2 * 3_600_000);

    // Moving the visit replaces the reminders and adds a "moved" message.
    const later = `${day}T18:00:00.000Z`;
    expect((await admin.rpc("reschedule_appointment", { p_id: appt.data, p_starts: later, p_ends: `${day}T22:00:00.000Z`, p_window_cap: 5, p_day_cap: 5, p_tz: "America/Chicago" })).error).toBeNull();
    j = await jobs();
    expect(j.filter((x) => x.kind === "reminder_24h" && x.status === "queued").map((x) => Date.parse(x.run_at))).toEqual([Date.parse(later) - 24 * 3_600_000]);
    expect(j.filter((x) => x.kind === "reminder_24h" && x.status === "cancelled")).toHaveLength(1);
    expect(j.some((x) => x.kind === "rescheduled")).toBe(true);

    // Cancelling drops queued reminders and plans a "cancelled" message.
    expect((await staffA.client.rpc("set_appointment_status", { p_id: appt.data, p_status: "cancelled", p_reason: "test" })).error).toBeNull();
    j = await jobs();
    expect(j.filter((x) => x.kind.startsWith("reminder") && x.status === "queued")).toEqual([]);
    expect(j.some((x) => x.kind === "cancelled" && x.status === "queued")).toBe(true);

    // Members read, other businesses do not; nobody signed in writes or claims.
    expect((await staffA.client.from("notification_jobs").select("id").eq("appointment_id", appt.data)).data!.length).toBeGreaterThan(0);
    expect((await ownerB.client.from("notification_jobs").select("id").eq("appointment_id", appt.data)).data).toEqual([]);
    expect((await ownerA.client.from("notification_jobs").insert({ workspace_id: wsA, appointment_id: appt.data, kind: "confirmation" })).error).not.toBeNull();
    expect((await ownerA.client.rpc("claim_notification_jobs", { p_limit: 5 })).error).not.toBeNull();

    await admin.from("appointments").delete().eq("workspace_id", wsA);
  }, 120_000);

  it("texting registration: owners save and send, staff and others never see the EIN, only platform admins decide", async () => {
    const details = {
      legal_name: "Test Air LLC", brand_name: "", business_type: "llc", ein: "12-3456789", website: "https://testair.com",
      street: "1 Main St", city: "Dallas", state: "TX", zip: "75201",
      contact_first_name: "Ann", contact_last_name: "Lee", contact_title: "Owner", contact_email: "ann@testair.com", contact_phone: "+12145550100",
    };
    expect((await staffA.client.rpc("save_texting_registration", { p_workspace: wsA, p: details, p_submit: true })).error).not.toBeNull();
    expect((await ownerB.client.rpc("save_texting_registration", { p_workspace: wsA, p: details, p_submit: true })).error).not.toBeNull();
    expect((await ownerA.client.from("texting_registrations").insert({ workspace_id: wsA, ...details })).error).not.toBeNull();
    // Bad values are refused by the database too.
    expect((await ownerA.client.rpc("save_texting_registration", { p_workspace: wsA, p: { ...details, ein: "123" }, p_submit: false })).error).not.toBeNull();

    expect((await ownerA.client.rpc("save_texting_registration", { p_workspace: wsA, p: details, p_submit: false })).data).toBe("draft");
    expect((await ownerA.client.rpc("set_texting_registration_status", { p_workspace: wsA, p_status: "approved", p_note: "" })).error).not.toBeNull();
    expect((await ownerA.client.rpc("save_texting_registration", { p_workspace: wsA, p: details, p_submit: true })).data).toBe("submitted");
    expect((await ownerA.client.from("texting_registrations").select("ein").eq("workspace_id", wsA).single()).data?.ein).toBe("12-3456789");
    expect((await staffA.client.from("texting_registrations").select("ein").eq("workspace_id", wsA)).data).toEqual([]);
    expect((await ownerB.client.from("texting_registrations").select("ein").eq("workspace_id", wsA)).data).toEqual([]);
    // Once sent, the owner can no longer change it.
    expect((await ownerA.client.rpc("save_texting_registration", { p_workspace: wsA, p: details, p_submit: true })).error?.message).toMatch(/locked/);

    const platform = await makeUser(admin, "platform-sms");
    try {
      await admin.from("profiles").update({ is_platform_admin: true }).eq("id", platform.id);
      const set = (status: string, note: string) => platform.client.rpc("set_texting_registration_status", { p_workspace: wsA, p_status: status, p_note: note });
      expect((await set("rejected", "")).error).not.toBeNull(); // a reason is required
      expect((await set("rejected", "EIN does not match the legal name")).error).toBeNull();
      // Rejected: back to the owner, who fixes and sends again.
      expect((await ownerA.client.rpc("save_texting_registration", { p_workspace: wsA, p: { ...details, legal_name: "Test Air Services LLC" }, p_submit: true })).data).toBe("submitted");
      expect((await set("approved", "")).error).toBeNull();
      const row = (await ownerA.client.from("texting_registrations").select("status, legal_name, decided_at").eq("workspace_id", wsA).single()).data!;
      expect(row).toMatchObject({ status: "approved", legal_name: "Test Air Services LLC" });
      expect(row.decided_at).not.toBeNull();
      expect((await platform.client.rpc("set_texting_registration_status", { p_workspace: wsB, p_status: "approved", p_note: "" })).error?.code).toBe("P0002");
      // History keeps the change but never the EIN.
      const log = (await admin.from("change_log").select("old_values, new_values").eq("table_name", "texting_registrations").eq("row_id", wsA)).data!;
      expect(log.length).toBeGreaterThan(0);
      expect(JSON.stringify(log)).not.toContain("3456789");
    } finally {
      await admin.auth.admin.deleteUser(platform.id);
    }
  }, 120_000);

  it("ZIP lookup: readable by any signed-in user, not writable, and finds real ZIPs", async () => {
    const miami = await ownerA.client.rpc("zip_city_matches", { p_city: "miami", p_state: "FL" });
    expect(miami.data).toHaveLength(1);
    expect(Number(miami.data![0].zip_count)).toBeGreaterThan(50);

    const springfield = await ownerA.client.rpc("zip_city_matches", { p_city: "Springfield", p_state: null });
    expect(springfield.data!.length).toBeGreaterThan(5); // ambiguous -> app asks which state

    const near = await ownerA.client.rpc("zips_within", { p_lat: miami.data![0].lat, p_lng: miami.data![0].lng, p_miles: 5, p_limit: 400 });
    expect(near.data!.length).toBeGreaterThan(5);
    expect(near.data!.every((r: { zip: string }) => /^\d{5}$/.test(r.zip))).toBe(true);
    expect(near.data![0].miles).toBeLessThanOrEqual(near.data!.at(-1)!.miles);

    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    expect((await anon.from("us_zip_codes").select("zip").limit(1)).data).toEqual([]);
    expect((await anon.rpc("zips_within", { p_lat: 25.77, p_lng: -80.19, p_miles: 5 })).error).not.toBeNull();
    const forged = await ownerA.client.from("us_zip_codes").insert({ zip: "00000", city: "X", state: "XX", lat: 0, lng: 0 });
    expect(forged.error).not.toBeNull();
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
