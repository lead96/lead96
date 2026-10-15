"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { bindNumber } from "@/lib/voice/retell";

export type TextingStatusState = { error?: string; message?: string } | undefined;

/**
 * Platform admin moves a business's texting registration along (filed in Retell, approved,
 * needs changes). On approval the business's numbers are re-linked so texts go out at once.
 */
export async function setTextingStatusAction(_: TextingStatusState, formData: FormData): Promise<TextingStatusState> {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) return { error: "Platform admins only." };
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (status === "rejected" && !note) return { error: "Write what the owner must fix (they see this note)." };

  // Through the user's session, so the function checks the platform admin and logs who did it.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_texting_registration_status", { p_workspace: workspaceId, p_status: status, p_note: note });
  if (error) return { error: error.code === "P0002" ? "Nothing sent by this business yet." : "Could not save." };

  const db = createAdminClient();
  await db.from("audit_log").insert({ actor_id: profile.id, action: `texting.${status}`, target: workspaceId, metadata: { note: note || null }, workspace_id: workspaceId });

  let linked = "";
  if (status === "approved") {
    const [{ data: agent }, { data: numbers }] = await Promise.all([
      db.from("voice_agents").select("retell_agent_id, retell_chat_agent_id").eq("workspace_id", workspaceId).maybeSingle(),
      db.from("phone_numbers").select("e164, nickname").eq("workspace_id", workspaceId),
    ]);
    if (agent?.retell_agent_id && numbers?.length) {
      const results = await Promise.all(
        numbers.map((n) =>
          bindNumber(n.e164, agent.retell_agent_id, { nickname: n.nickname ?? undefined, smsAgentId: agent.retell_chat_agent_id })
            .then((r) => r.smsLinked)
            .catch(() => false),
        ),
      );
      linked = results.every(Boolean)
        ? " Texting is linked to the number."
        : " Texting could not be linked yet: check the number's SMS status in Retell, then assign it again on AI voice.";
    } else linked = " No AI caller or number yet: texting links when the number is assigned.";
  }
  revalidatePath("/admin/texting");
  return { message: `Saved.${linked}` };
}
