"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { disconnect, GoogleAdsError, syncAccount, type SyncSummary } from "@/lib/google/ads";
import { createAdminClient } from "@/lib/supabase/server";

async function requirePlatformAdmin() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) throw new Error("Platform admins only.");
  return profile;
}

async function audit(actorId: string, action: string, target: string, metadata: Record<string, unknown> = {}, workspaceId: string | null = null) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, target, metadata, workspace_id: workspaceId });
}

export type AssignState = { error?: string; message?: string } | undefined;

/** Assigns a Google Ads account to a business (or removes the assignment). */
export async function assignAccount(_: AssignState, formData: FormData): Promise<AssignState> {
  const profile = await requirePlatformAdmin();
  const externalId = String(formData.get("external_id") ?? "").replace(/\D/g, "");
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!externalId) return { error: "Missing account." };
  const admin = createAdminClient();

  if (!workspaceId) {
    const { data } = await admin.from("ad_accounts").delete().eq("platform", "google").eq("external_id", externalId).select("workspace_id");
    if (data?.length) await audit(profile.id, "google_ads.account_unassigned", externalId, {}, data[0].workspace_id);
    revalidatePath("/admin/google");
    return { message: "Not assigned." };
  }

  const { error } = await admin.from("ad_accounts").upsert(
    {
      platform: "google",
      external_id: externalId,
      workspace_id: workspaceId,
      name: String(formData.get("name") ?? "").slice(0, 200) || null,
      currency: String(formData.get("currency") ?? "") || null,
      time_zone: String(formData.get("time_zone") ?? "") || null,
      created_by: profile.id,
    },
    { onConflict: "platform,external_id" },
  );
  if (error) return { error: "Could not save the assignment." };
  await audit(profile.id, "google_ads.account_assigned", externalId, {}, workspaceId);
  revalidatePath("/admin/google");
  return { message: "Saved." };
}

export type SyncState = { error?: string; summary?: SyncSummary } | undefined;

/** Pulls the last 30 days of leads and spend for one assigned account now. */
export async function syncNow(_: SyncState, formData: FormData): Promise<SyncState> {
  await requirePlatformAdmin();
  const { data: account } = await createAdminClient()
    .from("ad_accounts")
    .select("id, workspace_id, external_id, currency, last_sync_at")
    .eq("id", String(formData.get("account_id") ?? ""))
    .maybeSingle();
  if (!account) return { error: "Assign the account to a business first." };
  try {
    const summary = await syncAccount(account, 30);
    revalidatePath("/admin/google");
    return { summary };
  } catch (e) {
    revalidatePath("/admin/google");
    return { error: e instanceof GoogleAdsError ? e.message : "Sync failed." };
  }
}

export async function disconnectGoogle() {
  const profile = await requirePlatformAdmin();
  await disconnect();
  await audit(profile.id, "google_ads.disconnected", "google_ads");
  revalidatePath("/admin/google");
  revalidatePath("/admin");
}
