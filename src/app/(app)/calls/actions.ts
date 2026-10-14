"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { startManualCall } from "@/lib/voice/jobs";

export type ReviewState = { error?: string; message?: string } | undefined;

/** Marks an AI call as reviewed, optionally correcting its outcome (logged on the timeline). */
export async function reviewCall(_: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireWorkspace();
  const callId = String(formData.get("call_id") ?? "");
  const outcome = String(formData.get("outcome") ?? "") || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_call", { p_call: callId, p_outcome: outcome });
  if (error) return { error: error.code === "22023" ? "Unknown outcome." : "Could not save. Please try again." };
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
  return { message: "Saved." };
}

export type CallNowState = { error?: string; message?: string } | undefined;

/** Asks the AI to call this customer now. */
export async function callNow(_: CallNowState, formData: FormData): Promise<CallNowState> {
  const workspace = await requireWorkspace();
  const customerId = String(formData.get("customer_id") ?? "");
  // RLS: only a member of this business can see (and so call) the customer.
  const supabase = await createClient();
  const { data: customer } = await supabase.from("customers").select("id").eq("id", customerId).eq("workspace_id", workspace.id).maybeSingle();
  if (!customer) return { error: "Customer not found." };
  const r = await startManualCall(workspace.id, customerId);
  revalidatePath(`/leads/${customerId}`);
  if (r.result === "called") return { message: "The AI is calling now. The result appears here when the call ends." };
  if (r.result === "deferred") return { message: `Outside calling hours: the AI will call at the start of the next calling window.` };
  // Rule-based refusals are meant for people ("Asked not to be called."); provider errors are not.
  if (r.result === "failed") return { error: "The call could not be placed (phone provider error). Please try again later." };
  return { error: r.reason ?? "Could not start the call." };
}
