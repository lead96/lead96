"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile, requireOwner } from "@/lib/auth";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { US_TIMEZONES } from "@/lib/timezones";

export type SettingsState =
  | { error?: string; message?: string; inviteUrl?: string; fields?: Record<string, string> }
  | undefined;

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  timezone: z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]]),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
});

export async function updateBusiness(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const workspace = await requireOwner();
  const parsed = businessSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    phone: formData.get("phone") || undefined,
    website: formData.get("website") || undefined,
  });
  const fields = Object.fromEntries(
    ["name", "timezone", "phone", "website"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      phone: parsed.data.phone ?? null,
      website: parsed.data.website ?? null,
    })
    .eq("id", workspace.id);
  if (error) return { error: "Could not save. Please try again.", fields };

  revalidatePath("/", "layout");
  return { message: "Saved." };
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["owner", "staff"]),
});

export async function inviteMember(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const workspace = await requireOwner();
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  const fields = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "staff") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspace.id,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      invited_by: user.user?.id,
    })
    .select("id, token")
    .single();
  if (error || !data) return { error: "Could not create the invite.", fields };

  revalidatePath("/settings");
  const inviteUrl = `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${data.token}`;
  const profile = await getProfile();
  const sent = await sendEmail(
    {
      to: parsed.data.email,
      ...inviteEmail({ team: workspace.name, inviter: profile?.full_name || profile?.email || null, role: parsed.data.role, url: inviteUrl }),
      replyTo: profile?.email ?? undefined,
    },
    `invite-${data.id}`,
  );
  if (!sent.ok) console.error("Invite email not sent:", sent.error);
  // The link is always shown too, so the owner can share it another way.
  return {
    message: sent.ok
      ? `Invite sent to ${parsed.data.email}. You can also share this link:`
      : `Invite created for ${parsed.data.email}, but the email could not be sent. Share this link with them:`,
    inviteUrl,
  };
}

export async function removeMember(formData: FormData) {
  const workspace = await requireOwner();
  const userId = z.uuid().parse(formData.get("userId"));
  const supabase = await createClient();
  // RLS blocks removing yourself and anything outside the owner's workspace.
  await supabase.from("workspace_members").delete().eq("workspace_id", workspace.id).eq("user_id", userId);
  revalidatePath("/settings");
}

export async function revokeInvite(formData: FormData) {
  const workspace = await requireOwner();
  const inviteId = z.uuid().parse(formData.get("inviteId"));
  const supabase = await createClient();
  await supabase.from("workspace_invites").delete().eq("workspace_id", workspace.id).eq("id", inviteId);
  revalidatePath("/settings");
}

export type AutoCallState = { error?: string; message?: string } | undefined;

/** Owner switch: let the AI call new form leads automatically. */
export async function setAutoCall(_: AutoCallState, formData: FormData): Promise<AutoCallState> {
  const workspace = await requireOwner();
  const on = formData.get("on") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_call", { p_workspace: workspace.id, p_on: on });
  if (error) return { error: error.code === "P0002" ? "The AI caller is not set up for this business yet." : "Could not save. Please try again." };
  revalidatePath("/settings");
  return { message: on ? "The AI now calls new leads automatically." : "Automatic calls are off." };
}
