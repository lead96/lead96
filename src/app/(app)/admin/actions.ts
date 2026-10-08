"use server";

import { getProfile } from "@/lib/auth";
import { runLiveChecks, type LiveCheck } from "@/lib/admin/checks";

export type LiveCheckState = { checks?: LiveCheck[]; at?: string; error?: string } | undefined;

export async function liveChecks(): Promise<LiveCheckState> {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) return { error: "Platform admins only." };
  return { checks: await runLiveChecks(), at: new Date().toISOString() };
}
