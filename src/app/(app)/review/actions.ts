"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import { parseAmount } from "@/lib/leads/outcomes";
import { REVIEW_ACTIONS, type ReviewAction } from "@/lib/review/items";
import { createClient } from "@/lib/supabase/server";

export type ReviewState = { error?: string; message?: string } | undefined;

const ERRORS: Record<string, string> = {
  value_required: "Choose the right value to correct it.",
  bad_value: "That value is not valid.",
  done: "Someone already handled this item.",
};

/** Approve / correct / reject / not sure on one review item (applied and logged by the database). */
export async function resolveReview(_: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireWorkspace();
  const action = String(formData.get("action") ?? "") as ReviewAction;
  if (!(action in REVIEW_ACTIONS)) return { error: "Unknown action." };
  let value = String(formData.get("value") ?? "").trim();
  if (action === "correct" && formData.get("field") === "revenue") {
    const n = parseAmount(value);
    if (n === null) return { error: "Enter the right amount in dollars, like 4500." };
    value = String(n);
  }
  if (action === "correct" && !value) return { error: ERRORS.value_required };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_review_item", {
    p_item: String(formData.get("item_id") ?? ""),
    p_action: action,
    p_value: action === "correct" ? value : null,
    p_reason: String(formData.get("reason") ?? "").slice(0, 500) || null,
  });
  if (error) return { error: ERRORS[Object.keys(ERRORS).find((k) => error.message.includes(k)) ?? ""] ?? "Could not save. Please try again." };
  // Layout: the Review count in the menu changes too.
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
