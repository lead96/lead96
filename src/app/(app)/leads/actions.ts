"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser, requireWorkspace } from "@/lib/auth";
import { IMPORT_CHUNK, matchService } from "@/lib/leads/csv";
import { ingestLead, ingestLeads } from "@/lib/leads/ingest";
import { CUSTOMER_STATUSES, type CustomerStatus, type RawLead } from "@/lib/leads/normalize";
import { loadSetupContext } from "@/lib/setup/service";
import { createAdminClient, createClient } from "@/lib/supabase/server";

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

const cell = (max: number) => z.string().trim().max(max).optional();
const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(2),
        full_name: cell(200),
        phone: cell(40),
        email: cell(320),
        zip: cell(20),
        service: cell(100),
        message: cell(4000),
        received_at: z.iso.datetime().optional(),
        campaign_name: cell(300),
        utm_source: cell(300),
        utm_medium: cell(300),
        utm_campaign: cell(300),
        keyword: cell(300),
        fields: z.record(z.string().max(60), z.string().max(500)).optional(),
      }),
    )
    .min(1)
    .max(IMPORT_CHUNK),
});

export type ImportChunkResult =
  | { ok: true; created: number; updated: number; duplicates: number; failed: { row: number; error: string }[] }
  | { ok: false; error: string };

/**
 * Imports one chunk of mapped CSV rows (the browser parses the file and sends ≤ 200 rows per call).
 * Owners only. Each row gets a stable id from its content, so importing the same file twice
 * doesn't add the same leads twice.
 */
export async function importLeads(input: z.input<typeof importSchema>): Promise<ImportChunkResult> {
  const workspace = await requireWorkspace();
  if (workspace.role !== "owner") return { ok: false, error: "Only the account owner can import leads." };
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The file data could not be read. Please re-upload the file." };
  const { fileName, rows } = parsed.data;

  const [ctx, user] = await Promise.all([loadSetupContext(await createClient(), workspace), getUser()]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the row number is for messages only
  const leads: RawLead[] = rows.map(({ row: _row, fields, ...r }) => ({
    ...r,
    workspace_id: workspace.id,
    kind: "form",
    source: "csv",
    external_id: rowId(r, fields),
    service: matchService(r.service, ctx.services) ?? null,
    form_name: fileName,
    fields: fields ?? {},
    received_at: r.received_at ?? null,
  }));
  const results = await ingestLeads(leads);

  const out = { ok: true as const, created: 0, updated: 0, duplicates: 0, failed: [] as { row: number; error: string }[] };
  results.forEach((r, i) => {
    if (!r.ok) out.failed.push({ row: rows[i].row, error: r.error });
    else if (r.duplicate) out.duplicates++;
    else if (r.customerCreated) out.created++;
    else out.updated++;
  });

  await createAdminClient()
    .from("audit_log")
    .insert({
      workspace_id: workspace.id,
      actor_id: user?.id ?? null,
      action: "leads.imported",
      target: fileName,
      metadata: { rows: rows.length, created: out.created, updated: out.updated, duplicates: out.duplicates, failed: out.failed.length },
    });
  revalidatePath("/leads");
  return out;
}

/** Stable id for a CSV row: same content → same id, so re-imports are recognized. */
function rowId(r: Record<string, string | undefined>, fields: Record<string, string> | undefined) {
  const canonical = JSON.stringify([
    Object.entries(r).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(fields ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return `csv_${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}
