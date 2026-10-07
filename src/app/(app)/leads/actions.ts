"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { ingestLead } from "@/lib/leads/ingest";
import { CUSTOMER_STATUSES, type CustomerStatus } from "@/lib/leads/normalize";
import { createClient } from "@/lib/supabase/server";

export type LeadFormState = { error?: string; message?: string; fields?: Record<string, string> } | undefined;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Add a lead by hand (e.g. a walk-in or a referral). Any member can do this. */
export async function addManualLead(_: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const workspace = await requireWorkspace();
  const fields = Object.fromEntries(["full_name", "phone", "email", "zip", "service", "message"].map((k) => [k, text(formData, k)]));
  const result = await ingestLead({
    workspace_id: workspace.id,
    kind: "form",
    source: "manual",
    full_name: fields.full_name,
    phone: fields.phone,
    email: fields.email,
    zip: fields.zip,
    service: fields.service || null,
    message: fields.message,
  });
  if (!result.ok) return { error: result.error, fields };
  revalidatePath("/leads");
  redirect(`/leads/${result.customerId}`);
}

export async function changeStatus(_: LeadFormState, formData: FormData): Promise<LeadFormState> {
  await requireWorkspace();
  const customerId = text(formData, "customer_id");
  const status = text(formData, "status") as CustomerStatus;
  if (!CUSTOMER_STATUSES.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_status", {
    p_customer: customerId,
    p_status: status,
    p_reason: text(formData, "reason").slice(0, 300) || null,
  });
  if (error) return { error: "Could not update the status." };
  revalidatePath(`/leads/${customerId}`);
  revalidatePath("/leads");
  return { message: "Status updated." };
}

export async function saveNotes(_: LeadFormState, formData: FormData): Promise<LeadFormState> {
  await requireWorkspace();
  const customerId = text(formData, "customer_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_customer_notes", { p_customer: customerId, p_notes: text(formData, "notes") });
  if (error) return { error: "Could not save the notes." };
  revalidatePath(`/leads/${customerId}`);
  return { message: "Saved." };
}
