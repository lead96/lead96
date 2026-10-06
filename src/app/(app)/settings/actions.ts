"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
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
    .select("token")
    .single();
  if (error || !data) return { error: "Could not create the invite.", fields };

  revalidatePath("/settings");
  // Email delivery arrives with the email provider; until then the owner shares the link.
  return {
    message: `Invite created for ${parsed.data.email}. Share this link with them:`,
    inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invite/${data.token}`,
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
