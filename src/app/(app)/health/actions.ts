"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type DuplicateState = { error?: string; message?: string } | undefined;

/** Merge or "different people" for a possible duplicate pair. */
export async function resolveDuplicate(_: DuplicateState, formData: FormData): Promise<DuplicateState> {
  await requireWorkspace();
  const ids = z.object({ keep: z.uuid(), other: z.uuid() }).safeParse({ keep: formData.get("keep"), other: formData.get("other") });
  if (!ids.success) return { error: "Missing customer." };
  const supabase = await createClient();
  const { error } =
    formData.get("action") === "merge"
      ? await supabase.rpc("merge_customers", { p_keep: ids.data.keep, p_merge: ids.data.other })
      : await supabase.rpc("dismiss_duplicate", { p_customer: ids.data.keep, p_other: ids.data.other });
  if (error) return { error: error.message.includes("already merged") ? "One of them was already merged." : "Could not save. Please try again." };
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
