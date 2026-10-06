"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, selectWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { US_TIMEZONES } from "@/lib/timezones";

export type OnboardingState = { error?: string; fields?: Record<string, string> } | undefined;

const schema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  timezone: z.enum(US_TIMEZONES.map((t) => t.value) as [string, ...string[]]),
});

export async function createWorkspace(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireUser();
  const parsed = schema.safeParse({ name: formData.get("name"), timezone: formData.get("timezone") });
  const fields = { name: String(formData.get("name") ?? ""), timezone: String(formData.get("timezone") ?? "") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_vertical: "hvac",
  });
  if (error || !workspaceId) return { error: "Could not create your workspace. Please try again.", fields };

  const { error: tzError } = await supabase
    .from("workspaces")
    .update({ timezone: parsed.data.timezone })
    .eq("id", workspaceId);
  if (tzError) return { error: "Workspace created, but saving the time zone failed. Update it in Settings." };

  await selectWorkspace(workspaceId);
  redirect("/setup");
}
