/**
 * Lead intake + CRM tests against the linked Supabase project: deduplication, idempotency,
 * logged status changes and tenant isolation for customers / leads / landing pages.
 * Skipped when Supabase env vars are missing.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeLead, type RawLead } from "@/lib/leads/normalize";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

const run = Date.now().toString(36);
const password = `Test-${run}-pw!`;
type TestUser = { id: string; email: string; client: SupabaseClient };

async function makeUser(admin: SupabaseClient, label: string): Promise<TestUser> {
  const email = `leads-${label}-${run}@test.leadgen.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, client };
}

describe.skipIf(!configured)("lead intake and CRM", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, ownerB: TestUser, staffA: TestUser;
  let wsA: string, wsB: string;

  const ingest = async (lead: Omit<RawLead, "workspace_id"> & { workspace_id?: string }) => {
    const n = normalizeLead({ workspace_id: wsA, ...lead } as RawLead);
    if (!n.ok) throw new Error(n.error);
    const { data, error } = await admin.rpc("ingest_lead", { p: n.lead });
    if (error) throw error;
    return data as { lead_id: string; customer_id: string; customer_created: boolean; duplicate: boolean };
  };

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    [ownerA, ownerB, staffA] = await Promise.all([makeUser(admin, "owner-a"), makeUser(admin, "owner-b"), makeUser(admin, "staff-a")]);
    const a = await ownerA.client.rpc("create_workspace", { p_name: `Leads A ${run}` });
    const b = await ownerB.client.rpc("create_workspace", { p_name: `Leads B ${run}` });
    if (a.error || b.error) throw a.error ?? b.error;
    wsA = a.data;
    wsB = b.data;
    const inv = await ownerA.client.from("workspace_invites").insert({ workspace_id: wsA, email: staffA.email, role: "staff" }).select("token").single();
    if (inv.error) throw inv.error;
    const acc = await staffA.client.rpc("accept_invite", { p_token: inv.data.token });
    if (acc.error) throw acc.error;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("workspaces").delete().in("id", [wsA, wsB].filter(Boolean));
    const results = await Promise.all([ownerA, ownerB, staffA].filter(Boolean).map((u) => admin.auth.admin.deleteUser(u.id)));
    const failed = results.filter((r) => r.error && !/not.?found/i.test(r.error.message));
    if (failed.length) throw new Error(`test user cleanup failed: ${failed[0].error!.message}`);
  });

  it("the same person across sources and formats becomes one customer", async () => {
    const first = await ingest({ kind: "form", source: "landing_page", full_name: "Ana Ruiz", phone: "(305) 555-0101", zip: "33101", utm_source: "google" });
    expect(first.customer_created).toBe(true);
    // Same phone in another format, now with an email → same customer, email filled in.
    const second = await ingest({ kind: "form", source: "meta", phone: "+1 305 555 0101", email: "Ana@Example.com", external_id: `m-${run}`, campaign_id: "c1" });
    expect(second.customer_id).toBe(first.customer_id);
    // Same email, no phone (a call-back from another number would match by phone instead).
    const third = await ingest({ kind: "form", source: "csv", email: "ana@example.com" });
    expect(third.customer_id).toBe(first.customer_id);

    const { data: c } = await admin.from("customers").select("*").eq("id", first.customer_id).single();
    expect(c).toMatchObject({ phone: "+13055550101", email: "ana@example.com", full_name: "Ana Ruiz", zip: "33101", lead_count: 3, first_source: "landing_page" });
    const { data: ev } = await admin.from("events").select("type").eq("customer_id", first.customer_id);
    expect(ev!.filter((e) => e.type === "lead.received")).toHaveLength(3);
    expect(ev!.filter((e) => e.type === "customer.created")).toHaveLength(1);
  });

  it("a webhook delivered twice creates one lead", async () => {
    const a = await ingest({ kind: "form", source: "meta", phone: "305-555-0102", external_id: `dup-${run}`, campaign_id: "c1" });
    const b = await ingest({ kind: "form", source: "meta", phone: "305-555-0102", external_id: `dup-${run}`, campaign_id: "c1" });
    expect(b.duplicate).toBe(true);
    expect(b.lead_id).toBe(a.lead_id);
    const { count } = await admin.from("leads").select("*", { count: "exact", head: true }).eq("external_id", `dup-${run}`);
    expect(count).toBe(1);
  });

  it("phone and email matching two different customers is flagged, not silently merged", async () => {
    const p = await ingest({ kind: "form", source: "manual", phone: "305-555-0103" });
    const e = await ingest({ kind: "form", source: "manual", email: `other-${run}@example.com` });
    const both = await ingest({ kind: "form", source: "manual", phone: "305-555-0103", email: `other-${run}@example.com` });
    expect(both.customer_id).toBe(p.customer_id);
    const { data: ev } = await admin.from("events").select("type, payload").eq("customer_id", p.customer_id).eq("type", "customer.possible_duplicate");
    expect(ev).toHaveLength(1);
    expect((ev![0].payload as { other_customer_id: string }).other_customer_id).toBe(e.customer_id);
  });

  it("source data is flagged incomplete instead of invented", async () => {
    const r = await ingest({ kind: "form", source: "landing_page", phone: "305-555-0104" });
    const { data } = await admin.from("leads").select("attribution_complete").eq("id", r.lead_id).single();
    expect(data!.attribution_complete).toBe(false);
    expect(normalizeLead({ workspace_id: wsA, kind: "form", source: "landing_page", phone: "305-555-0104", gclid: "abc" }).ok && true).toBe(true);
  });

  it("only the server can ingest; other businesses can't see the leads", async () => {
    const n = normalizeLead({ workspace_id: wsA, kind: "form", source: "manual", phone: "305-555-0105" });
    if (!n.ok) throw new Error();
    expect((await ownerA.client.rpc("ingest_lead", { p: n.lead })).error).not.toBeNull();
    expect((await ownerA.client.from("leads").insert({ workspace_id: wsA, customer_id: crypto.randomUUID(), kind: "form", source: "manual" })).error).not.toBeNull();

    expect((await ownerA.client.from("customers").select("id").eq("workspace_id", wsA)).data!.length).toBeGreaterThan(0);
    expect((await staffA.client.from("leads").select("id").eq("workspace_id", wsA)).data!.length).toBeGreaterThan(0);
    expect((await ownerB.client.from("customers").select("id").eq("workspace_id", wsA)).data).toEqual([]);
    expect((await ownerB.client.from("leads").select("id").eq("workspace_id", wsA)).data).toEqual([]);
  });

  it("status changes are logged; staff can change status, other businesses can't", async () => {
    const r = await ingest({ kind: "call", source: "call", phone: "305-555-0106" });
    expect((await staffA.client.rpc("set_customer_status", { p_customer: r.customer_id, p_status: "contacted", p_reason: "called back" })).error).toBeNull();
    expect((await ownerB.client.rpc("set_customer_status", { p_customer: r.customer_id, p_status: "won" })).error).not.toBeNull();
    expect((await ownerA.client.rpc("set_customer_status", { p_customer: r.customer_id, p_status: "bogus" })).error).not.toBeNull();
    // Direct updates bypassing the log are not allowed.
    await ownerA.client.from("customers").update({ status: "won" }).eq("id", r.customer_id);

    const { data: c } = await admin.from("customers").select("status").eq("id", r.customer_id).single();
    expect(c!.status).toBe("contacted");
    const { data: ev } = await admin.from("events").select("payload, actor_id").eq("customer_id", r.customer_id).eq("type", "customer.status_changed");
    expect(ev).toEqual([{ payload: { from: "new", to: "contacted", reason: "called back" }, actor_id: staffA.id }]);
  });

  it("bulk ingest: one call for many rows, bad rows reported without failing the rest, re-imports recognized", async () => {
    const rows = [
      { kind: "form", source: "csv", phone: "+13055550110", full_name: "Bulk One", external_id: `csv-a-${run}` },
      { kind: "form", source: "csv", email: `bulk-${run}@example.com`, external_id: `csv-b-${run}`, received_at: "2026-09-01T16:00:00Z" },
      // Fails the source check inside the database; must not take the other rows down with it.
      { kind: "form", source: "nope", phone: "+13055550111", external_id: `csv-c-${run}` },
      { kind: "form", source: "csv", phone: "+13055550110", external_id: `csv-d-${run}` }, // same person as row 1
    // Already normalized, as ingestLeads() sends them.
    ].map((r) => ({ workspace_id: wsA, attribution_complete: false, fields: {}, consent_given: false, ...r }));

    const { data, error } = await admin.rpc("ingest_leads", { p: rows });
    expect(error).toBeNull();
    const res = data as ({ customer_id: string; customer_created: boolean; duplicate: boolean } | { error: string })[];
    expect(res).toHaveLength(4);
    expect(res[0]).toMatchObject({ customer_created: true, duplicate: false });
    expect(res[1]).toMatchObject({ customer_created: true });
    expect(res[2]).toHaveProperty("error");
    expect(res[3]).toMatchObject({ customer_created: false, customer_id: (res[0] as { customer_id: string }).customer_id });
    const { data: c } = await admin.from("customers").select("first_lead_at").eq("id", (res[1] as { customer_id: string }).customer_id).single();
    expect(new Date(c!.first_lead_at).toISOString()).toBe("2026-09-01T16:00:00.000Z");

    const again = (await admin.rpc("ingest_leads", { p: rows.slice(0, 2) })).data as { duplicate: boolean }[];
    expect(again.map((r) => r.duplicate)).toEqual([true, true]);
    expect((await ownerA.client.rpc("ingest_leads", { p: rows })).error).not.toBeNull();
  });

  it("landing pages: owners edit, staff read only, slugs are global and validated", async () => {
    const slug = `cool-air-${run}`;
    const ins = await ownerA.client.from("landing_pages").insert({ workspace_id: wsA, name: "Main", slug, template: "call_first" }).select("id").single();
    expect(ins.error).toBeNull();
    expect((await staffA.client.from("landing_pages").insert({ workspace_id: wsA, name: "x", slug: `staff-${run}`, template: "call_first" })).error).not.toBeNull();
    expect((await staffA.client.from("landing_pages").select("id").eq("id", ins.data!.id)).data).toHaveLength(1);
    expect((await ownerB.client.from("landing_pages").insert({ workspace_id: wsB, name: "dup", slug, template: "call_first" })).error).not.toBeNull();
    expect((await ownerA.client.from("landing_pages").insert({ workspace_id: wsA, name: "bad", slug: "Bad Slug!", template: "call_first" })).error).not.toBeNull();
    expect((await ownerB.client.from("landing_pages").select("id").eq("id", ins.data!.id)).data).toEqual([]);
  });
});
