"use server";

import { redirect } from "next/navigation";
import { selectWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { INVITE_ERROR_CODES, type InviteErrorCode } from "./errors";

function invitePath(token: string) {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Accept an invite as the signed-in user, then open that workspace. */
export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("accept_invite", { p_token: token });

  if (error || !workspaceId) {
    const code: InviteErrorCode | "unknown" =
      INVITE_ERROR_CODES.find((c) => error?.message.includes(c)) ?? "unknown";
    if (code === "unknown") console.error("accept_invite failed:", error);
    redirect(`${invitePath(token)}?error=${code}`);
  }

  await selectWorkspace(workspaceId);
  redirect("/dashboard");
}

/** Signed in as the wrong account: sign out and come back to the invite as the invited email. */
export async function switchAccountForInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "");
  const supabase = await createClient();
  await supabase.auth.signOut();
  const params = new URLSearchParams({ next: invitePath(token), email });
  redirect(`/login?${params}`);
}
