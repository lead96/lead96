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

  it("outcomes: members record results with the rules enforced, pending visits are counted, one reminder a day", async () => {
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Outcome Test", phone: `+1214557${String(Date.now()).slice(-4)}` }).select("id").single();
    const id = cust.data!.id;
    const set = (c: typeof staffA.client, status: string, reason: string | null, amount: number | null, note: string | null = null) =>
      c.rpc("set_outcome", { p_customer: id, p_status: status, p_reason: reason, p_amount: amount, p_note: note });
    // The rules hold in the database, not only in the form.
    expect((await set(staffA.client, "won", null, null)).error?.message).toMatch(/amount_required/);
    expect((await set(staffA.client, "lost", null, null)).error?.message).toMatch(/reason_required/);
    expect((await set(staffA.client, "lost", "outside_area", null)).error?.message).toMatch(/reason_required/); // a not-qualified reason
    expect((await set(staffA.client, "maybe", null, null)).error?.message).toMatch(/invalid_status/);
    expect((await set(ownerB.client, "won", null, 100)).error).not.toBeNull();
    // Customers can't be edited directly.
    await ownerA.client.from("customers").update({ revenue: 1 }).eq("id", id);
    expect((await admin.from("customers").select("revenue").eq("id", id).single()).data?.revenue).toBeNull();

    expect((await set(staffA.client, "estimate", null, 4200, "quote sent")).data).toBe(true);
    expect((await set(staffA.client, "won", null, 4500.555)).data).toBe(true);
    let c: Record<string, unknown> = (await admin.from("customers").select("status, revenue, estimate_amount, closed_at").eq("id", id).single()).data!;
    expect(c).toMatchObject({ status: "won", revenue: 4500.56, estimate_amount: 4200 });
    const closed = c.closed_at;
    expect(closed).not.toBeNull();
    expect((await set(staffA.client, "won", null, 4500.56)).data).toBe(false); // nothing changed
    expect((await set(ownerA.client, "won", null, 4800, "extra part")).data).toBe(true); // correction keeps the close date
    c = (await admin.from("customers").select("status, revenue, closed_at").eq("id", id).single()).data!;
    expect(c.revenue).toBe(4800);
    expect(c.closed_at).toBe(closed);
    expect((await set(ownerA.client, "lost", "competitor", null)).data).toBe(true);
    c = (await admin.from("customers").select("status, revenue, lost_reason").eq("id", id).single()).data!;
    expect(c).toMatchObject({ status: "lost", revenue: null, lost_reason: "competitor" });
    const ev = (await admin.from("events").select("actor_id, payload").eq("customer_id", id).eq("type", "customer.status_changed").order("id")).data!;
    expect(ev.map((e) => e.payload.to)).toEqual(["estimate", "won", "won", "lost"]);
    expect(ev[0]).toMatchObject({ actor_id: staffA.id, payload: { from: "new", amount: 4200, reason: "quote sent" } });
    expect(ev[3].payload).toMatchObject({ reason_code: "competitor" });

    // Pending: a past visit still booked, and a done visit without a final result.
    const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const cust2 = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Pending Test", phone: `+1214558${String(Date.now()).slice(-4)}` }).select("id").single();
    const past = await admin.from("appointments").insert([
      { workspace_id: wsA, customer_id: cust2.data!.id, starts_at: `${day(3)}T13:00:00Z`, ends_at: `${day(3)}T17:00:00Z`, source: "manual", status: "scheduled" },
      { workspace_id: wsA, customer_id: id, starts_at: `${day(2)}T13:00:00Z`, ends_at: `${day(2)}T17:00:00Z`, source: "manual", status: "completed" },
    ]).select("id");
    expect(past.error).toBeNull();
    const counts = async (cl: typeof staffA.client) => (await cl.rpc("pending_outcome_counts", { p_workspace: wsA }).single()).data as { visits: number; jobs: number };
    expect(await counts(staffA.client)).toMatchObject({ visits: 1, jobs: 0 }); // the done visit's customer is lost: final
    expect((await set(ownerA.client, "showed", null, null)).data).toBe(true);
    expect(await counts(staffA.client)).toMatchObject({ visits: 1, jobs: 1 });
    expect(await counts(ownerB.client)).toMatchObject({ visits: 0, jobs: 0 }); // another business sees nothing

    // Reminder: planned once per day for a business with something pending; never by users.
    // Scoped to this business, so the test never queues reminders for real ones.
    expect((await ownerA.client.rpc("plan_outcome_reminders", { p_workspace: wsA })).error).not.toBeNull();
    expect((await admin.rpc("plan_outcome_reminders", { p_workspace: wsA })).data).toBe(1);
    expect((await admin.rpc("plan_outcome_reminders", { p_workspace: wsA })).data).toBe(0);
    const reminders = (await admin.from("notification_jobs").select("kind, appointment_id").eq("workspace_id", wsA).eq("kind", "pending_outcomes")).data!;
    expect(reminders).toEqual([{ kind: "pending_outcomes", appointment_id: null }]);
    // A visit message can't be filed without its visit (and the reverse).
    expect((await admin.from("notification_jobs").insert({ workspace_id: wsA, kind: "confirmation" })).error).not.toBeNull();

    await admin.from("notification_jobs").delete().eq("workspace_id", wsA);
    await admin.from("appointments").delete().eq("workspace_id", wsA);
  }, 120_000);

  it("dashboard and attribution reports: cohort by first-touch channel / campaign / keyword, stages reached, spend; only members see them", async () => {
    // A fixed past week no other test writes to.
    const day = "2025-03-0";
    let n = 0;
    const lead = async (p: Record<string, unknown>, d: number) => {
      n += 1;
      const r = await admin.rpc("ingest_lead", {
        p: { workspace_id: wsA, kind: "form", external_id: `dash-${run}-${n}`, phone: `+1214559${String(1000 + n)}`, fields: {}, received_at: `${day}${d}T15:00:00Z`, ...p },
      });
      expect(r.error).toBeNull();
      return r.data.customer_id as string;
    };
    const g1 = await lead({ source: "landing_page", gclid: "G1" }, 2); // landing page + Google click = Google Ads
    const g2 = await lead({ source: "google" }, 3);
    const m1 = await lead({ source: "landing_page", utm_source: "facebook" }, 3);
    const lp = await lead({ source: "landing_page" }, 4);
    const call = await lead({ source: "call", kind: "call" }, 5);
    // The same person later comes from another channel: first touch counts.
    await lead({ source: "meta", phone: `+1214559${String(1001)}` }, 6);

    await admin.rpc("set_outcome", { p_customer: g1, p_status: "won", p_reason: null, p_amount: 5000, p_note: null });
    await admin.from("appointments").insert([
      { workspace_id: wsA, customer_id: g1, starts_at: `${day}4T13:00:00Z`, ends_at: `${day}4T17:00:00Z`, source: "manual", status: "completed" },
      { workspace_id: wsA, customer_id: g2, starts_at: `${day}5T13:00:00Z`, ends_at: `${day}5T17:00:00Z`, source: "manual", status: "cancelled" },
      { workspace_id: wsA, customer_id: m1, starts_at: `${day}6T13:00:00Z`, ends_at: `${day}6T17:00:00Z`, source: "manual", status: "no_show" },
    ]);
    await admin.rpc("set_outcome", { p_customer: g2, p_status: "not_qualified", p_reason: "outside_area", p_amount: null, p_note: null });
    await admin.rpc("set_outcome", { p_customer: lp, p_status: "lost", p_reason: "price", p_amount: null, p_note: null });
    await admin.from("ad_spend_daily").insert([
      { workspace_id: wsA, platform: "google", account_external_id: `acc-${run}`, campaign_id: "c1", date: `${day}2`, cost: 120.5, clicks: 30 },
      { workspace_id: wsA, platform: "google", account_external_id: `acc-${run}`, campaign_id: "c1", date: `${day}8`, cost: 79.5, clicks: 10 },
      { workspace_id: wsA, platform: "google", account_external_id: `acc-${run}`, campaign_id: "c1", date: "2025-03-20", cost: 999, clicks: 1 }, // outside
      { workspace_id: wsA, platform: "meta", account_external_id: `acc-${run}`, campaign_id: "m1", date: `${day}3`, cost: 50, clicks: 5 },
    ]);

    const args = { p_workspace: wsA, p_from: "2025-03-01T00:00:00Z", p_to: "2025-03-09T00:00:00Z", p_from_date: "2025-03-01", p_to_date: "2025-03-08" };
    const { data, error } = await staffA.client.rpc("dashboard_report", args);
    expect(error).toBeNull();
    const ch = Object.fromEntries((data.channels as { channel: string }[]).map((c) => [c.channel, c]));
    expect(ch.google_ads).toMatchObject({ leads: 2, qualified: 1, booked: 1, showed: 1, won: 1, not_qualified: 1, revenue: 5000 });
    expect(ch.meta_ads).toMatchObject({ leads: 1, qualified: 1, booked: 1, showed: 0, won: 0 }); // no-show: booked, not showed
    expect(ch.landing_page).toMatchObject({ leads: 1, qualified: 1, booked: 0, lost: 1 }); // lost = qualified, not won
    expect(ch.call).toMatchObject({ leads: 1, qualified: 0 });
    expect(Object.keys(ch).sort()).toEqual(["call", "google_ads", "landing_page", "meta_ads"]);
    const spend = Object.fromEntries((data.spend as { platform: string; cost: number }[]).map((x) => [x.platform, Number(x.cost)]));
    expect(spend).toEqual({ google: 200, meta: 50 });
    expect(call).toBeTruthy();

    // Attribution: the same cohort by campaign / landing page / keyword.
    await admin.from("leads").update({ campaign_id: "111", campaign_name: "AC Repair" }).eq("customer_id", g2);
    await admin.from("leads").update({ utm_campaign: "spring", utm_term: "AC Repair Near Me " }).eq("customer_id", m1);
    const attr = async (dim: string) => (await staffA.client.rpc("attribution_report", { ...args, p_dim: dim })).data as { rows: Record<string, unknown>[]; spend: Record<string, unknown>[] };
    const byCampaign = await attr("campaign");
    expect(byCampaign.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "google_ads", key: "111", label: "AC Repair", leads: 1, not_qualified: 1 }),
        expect.objectContaining({ channel: "meta_ads", key: "spring", label: "spring", leads: 1, booked: 1 }),
        expect.objectContaining({ channel: "google_ads", key: null, leads: 1, won: 1 }),
      ]),
    );
    expect(byCampaign.spend.map((x) => [x.platform, x.campaign_id, Number(x.cost)]).sort()).toEqual([["google", "c1", 200], ["meta", "m1", 50]]);
    expect((await attr("keyword")).rows).toEqual(expect.arrayContaining([expect.objectContaining({ key: "ac repair near me", leads: 1 })]));
    expect((await attr("keyword")).spend).toEqual([]);
    expect((await attr("landing_page")).rows.reduce((n, x) => n + Number(x.leads), 0)).toBe(5);
    expect((await staffA.client.rpc("attribution_report", { ...args, p_dim: "bogus" })).data).toBeNull();
    expect((await ownerB.client.rpc("attribution_report", { ...args, p_dim: "campaign" })).data).toEqual({ rows: [], spend: [] });

    // Other businesses get nothing; nobody signed out runs it.
    const other = (await ownerB.client.rpc("dashboard_report", args)).data;
    expect(other).toEqual({ channels: [], spend: [] });
    expect((await createClient(url!, anonKey!).rpc("dashboard_report", args)).error).not.toBeNull();

    await admin.from("ad_spend_daily").delete().eq("account_external_id", `acc-${run}`);
    await admin.from("appointments").delete().eq("workspace_id", wsA);
  }, 120_000);

  it("review queue: filed from calls and outcomes, resolved once with before / after; members only", async () => {
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Review Test", phone: `+1214556${String(Date.now()).slice(-4)}` }).select("id").single();
    const id = cust.data!.id;
    const call = async (fields: Record<string, unknown>) => {
      const r = await admin.from("calls").insert({ workspace_id: wsA, customer_id: id, provider_call_id: `rv-${run}-${Math.random()}`, direction: "outbound", trigger: "manual", status: "ended", ...fields }).select("id").single();
      expect(r.error).toBeNull();
      return r.data!.id as string;
    };
    const items = async (where: Record<string, string>) => {
      let q = admin.from("review_items").select("*").eq("workspace_id", wsA);
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      return (await q).data!;
    };

    // A low-confidence call with an unknown service files two items; a test call files none.
    const c1 = await call({ outcome: "qualified", confidence: 0.4, analysis: { service: "unknown" }, needs_review: true });
    expect((await items({ call_id: c1 })).map((i) => i.kind).sort()).toEqual(["low_confidence", "unknown_service"]);
    await call({ trigger: "test", outcome: "other", confidence: 0.1, analysis: { emergency: true } });
    expect((await items({ customer_id: id })).length).toBe(2);
    // Updating the same call does not file twice.
    await admin.from("calls").update({ confidence: 0.3 }).eq("id", c1);
    expect((await items({ call_id: c1 })).length).toBe(2);

    // The AI said "not a fit"; the job was won anyway -> disagreement, and a big win -> high value.
    const c2 = await call({ outcome: "not_qualified", confidence: 0.9 });
    expect((await admin.rpc("set_outcome", { p_customer: id, p_status: "won", p_reason: null, p_amount: 12500, p_note: null })).error).toBeNull();
    const dis = (await items({ customer_id: id, kind: "disagreement" }))[0];
    expect(dis).toMatchObject({ field: "call_outcome", ai_value: "not_qualified", call_id: null, detail: { call_id: c2, result: "won" } });
    const high = (await items({ customer_id: id, kind: "high_value" }))[0];
    expect(high).toMatchObject({ field: "revenue", ai_value: "12500.00" });

    // Members only; nobody writes directly.
    expect((await staffA.client.from("review_items").select("id").eq("customer_id", id)).data!.length).toBe(4);
    expect((await ownerB.client.from("review_items").select("id").eq("customer_id", id)).data).toEqual([]);
    expect((await ownerA.client.from("review_items").update({ status: "approved" }).eq("id", dis.id).select()).data ?? []).toEqual([]);
    expect((await ownerB.client.rpc("resolve_review_item", { p_item: dis.id, p_action: "approve", p_value: null, p_reason: null })).error).not.toBeNull();

    // Correct the call result: applied to the call, AI's value kept, before / after stored, done once.
    const resolve = (item: string, action: string, value: string | null, reason: string | null = null) =>
      staffA.client.rpc("resolve_review_item", { p_item: item, p_action: action, p_value: value, p_reason: reason });
    expect((await resolve(dis.id, "correct", null)).error?.message).toMatch(/value_required/);
    expect((await resolve(dis.id, "correct", "maybe")).error?.message).toMatch(/bad_value/);
    expect((await resolve(dis.id, "correct", "qualified", "they had a second house in the area")).error).toBeNull();
    const c2row = (await admin.from("calls").select("outcome, original_outcome, needs_review").eq("id", c2).single()).data!;
    expect(c2row).toMatchObject({ outcome: "qualified", original_outcome: "not_qualified", needs_review: false });
    expect((await items({ id: dis.id }))[0]).toMatchObject({ status: "corrected", before: { outcome: "not_qualified" }, after: { outcome: "qualified" }, reviewed_by: staffA.id });
    expect((await resolve(dis.id, "approve", null)).error?.message).toMatch(/done/);

    // Revenue correction goes through set_outcome; "not sure" keeps the item aside, then it can be closed.
    expect((await resolve(high.id, "unsure", null)).error).toBeNull();
    expect((await items({ id: high.id }))[0].status).toBe("unsure");
    expect((await resolve(high.id, "correct", "1250")).error).toBeNull();
    expect((await admin.from("customers").select("revenue").eq("id", id).single()).data?.revenue).toBe(1250);

    // Service correction sets the customer's service.
    const svc = (await items({ call_id: c1, kind: "unknown_service" }))[0];
    expect((await resolve(svc.id, "correct", "repair")).error).toBeNull();
    expect((await admin.from("customers").select("service").eq("id", id).single()).data?.service).toBe("repair");

    // Reviewing the call on its own page closes its open call items too.
    expect((await staffA.client.rpc("review_call", { p_call: c1, p_outcome: null })).error).toBeNull();
    expect((await items({ call_id: c1, kind: "low_confidence" }))[0]).toMatchObject({ status: "approved", reason: "Reviewed on the call page" });
    const ev = (await admin.from("events").select("payload").eq("customer_id", id).eq("type", "review.resolved")).data!;
    expect(ev.length).toBe(4);

    await admin.from("calls").delete().eq("customer_id", id);
    await admin.from("customers").delete().eq("id", id);
  }, 120_000);

  it("data health: counts and lists per check; duplicates merged or dismissed; members only", async () => {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const health = async (c = staffA.client) => (await c.rpc("data_health", { p_workspace: wsA, p_since: since })).data as Record<string, number>;
    const list = async (check: string) => (await staffA.client.rpc("data_health_list", { p_workspace: wsA, p_check: check, p_since: since })).data as Record<string, string>[];
    const before = await health();
    const tail = String(Date.now()).slice(-4);
    const ingest = async (p: Record<string, unknown>) => {
      const r = await admin.rpc("ingest_lead", { p: { workspace_id: wsA, kind: "form", fields: {}, ...p } });
      expect(r.error).toBeNull();
      return r.data.customer_id as string;
    };
    // Two customers, then a lead whose phone matches one and email the other -> possible duplicate.
    const a = await ingest({ source: "landing_page", external_id: `dh-a-${run}`, full_name: "Ann Dup", phone: `+1214553${tail}`, consent_given: true, utm_source: "google", attribution_complete: true });
    const b = await ingest({ source: "landing_page", external_id: `dh-b-${run}`, full_name: null, email: `ann-${run}@example.com` });
    await ingest({ source: "landing_page", external_id: `dh-c-${run}`, phone: `+1214553${tail}`, email: `ann-${run}@example.com` });
    let h = await health();
    expect(h.duplicates).toBe(before.duplicates + 1);
    expect(h.missing_source).toBe(before.missing_source + 2); // b and the third lead have no campaign data
    expect(h.lead_no_consent).toBe(before.lead_no_consent + 2);
    expect((await list("duplicates")).some((r) => [r.customer_id, r.other_customer_id].sort().join() === [a, b].sort().join())).toBe(true);

    // An AI call to b (no consent on any lead) is flagged; won without revenue too.
    await admin.from("calls").insert({ workspace_id: wsA, customer_id: b, provider_call_id: `dh-${run}`, direction: "outbound", trigger: "manual", status: "ended", duration_seconds: 40, outcome: "qualified" });
    await admin.from("customers").update({ status: "won" }).eq("id", b);
    h = await health();
    expect(h.contact_no_consent).toBe(before.contact_no_consent + 1);
    expect(h.missing_transcript).toBe(before.missing_transcript + 1);
    expect(h.won_no_revenue).toBe(before.won_no_revenue + 1);
    expect((await list("contact_no_consent")).find((r) => r.customer_id === b)?.detail).toBe("AI call");
    expect((await staffA.client.rpc("data_health_list", { p_workspace: wsA, p_check: "nope", p_since: since })).error).not.toBeNull();
    // Other businesses see zeros and empty lists.
    expect(Object.values(await health(ownerB.client)).every((v) => v === 0)).toBe(true);
    expect((await ownerB.client.rpc("data_health_list", { p_workspace: wsA, p_check: "duplicates", p_since: since })).data).toEqual([]);

    // Merge b into a: everything moves, blanks filled, further status kept, b hidden; done once.
    expect((await ownerB.client.rpc("merge_customers", { p_keep: a, p_merge: b })).error).not.toBeNull();
    expect((await staffA.client.rpc("merge_customers", { p_keep: a, p_merge: b })).error).toBeNull();
    const keep = (await admin.from("customers").select("full_name, email, phone, status, lead_count, merged_into").eq("id", a).single()).data!;
    expect(keep).toMatchObject({ full_name: "Ann Dup", email: `ann-${run}@example.com`, status: "won", merged_into: null });
    expect(keep.lead_count).toBe(3);
    expect((await admin.from("customers").select("merged_into").eq("id", b).single()).data?.merged_into).toBe(a);
    expect((await admin.from("leads").select("id").eq("customer_id", b)).data).toEqual([]);
    expect((await admin.from("calls").select("customer_id").eq("provider_call_id", `dh-${run}`).single()).data?.customer_id).toBe(a);
    expect((await health()).duplicates).toBe(before.duplicates);
    expect((await health()).contact_no_consent).toBe(before.contact_no_consent); // a has consent
    expect((await staffA.client.rpc("merge_customers", { p_keep: a, p_merge: b })).error?.message).toMatch(/already merged/);
    // New leads with b's email now land on a.
    expect(await ingest({ source: "manual", external_id: `dh-d-${run}`, email: `ann-${run}@example.com` })).toBe(a);

    // "Different people" clears a pair without merging.
    const x = await ingest({ source: "manual", external_id: `dh-x-${run}`, phone: `+1214552${tail}` });
    const y = await ingest({ source: "manual", external_id: `dh-y-${run}`, email: `y-${run}@example.com` });
    await ingest({ source: "manual", external_id: `dh-z-${run}`, phone: `+1214552${tail}`, email: `y-${run}@example.com` });
    expect((await health()).duplicates).toBe(before.duplicates + 1);
    expect((await staffA.client.rpc("dismiss_duplicate", { p_customer: y, p_other: x })).error).toBeNull();
    expect((await health()).duplicates).toBe(before.duplicates);

    await admin.from("calls").delete().eq("provider_call_id", `dh-${run}`);
  }, 120_000);

  it("admin overview and failure feed: platform admins only, numbers per business", async () => {
    expect((await ownerA.client.rpc("admin_business_overview")).error).not.toBeNull();
    expect((await staffA.client.rpc("admin_error_feed", { p_limit: 10 })).error).not.toBeNull();
    const cust = await admin.from("customers").insert({ workspace_id: wsA, full_name: "Admin View", phone: `+1214550${String(Date.now()).slice(-4)}` }).select("id").single();
    const job = await admin.from("call_jobs").insert({ workspace_id: wsA, customer_id: cust.data!.id, trigger: "manual", status: "failed", reason: `test failure ${run}` }).select("id").single();
    expect(job.error).toBeNull();
    const platform = await makeUser(admin, "platform-overview");
    try {
      await admin.from("profiles").update({ is_platform_admin: true }).eq("id", platform.id);
      const { data, error } = await platform.client.rpc("admin_business_overview");
      expect(error).toBeNull();
      const a = (data as { id: string }[]).find((w) => w.id === wsA) as Record<string, unknown>;
      expect(a).toMatchObject({ name: `A ${run}`, owners: ownerA.email, members: 2 });
      expect(Number(a.errors_7d)).toBeGreaterThanOrEqual(1);
      expect((data as { id: string }[]).some((w) => w.id === wsB)).toBe(true);
      const feed = (await platform.client.rpc("admin_error_feed", { p_limit: 500 })).data as { kind: string; ref: string; message: string; workspace_id: string }[];
      expect(feed.find((f) => f.ref === job.data!.id)).toMatchObject({ kind: "call_job", workspace_id: wsA, message: `test failure ${run}` });
    } finally {
      await admin.auth.admin.deleteUser(platform.id);
      await admin.from("call_jobs").delete().eq("id", job.data!.id);
      await admin.from("customers").delete().eq("id", cust.data!.id);
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
