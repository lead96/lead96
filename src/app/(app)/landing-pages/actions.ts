"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, requireUser } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { SLUG_PATTERN, TEMPLATES, contentSchema, defaultContent, slugify, type TemplateKey } from "@/lib/landing/content";
import { loadSaved, loadSetupContext } from "@/lib/setup/service";
import { createClient } from "@/lib/supabase/server";

export type EditorState = { error?: string; message?: string } | undefined;

/** Create a draft pre-filled from the business profile, then open the editor. */
export async function createLandingPage(formData: FormData) {
  const workspace = await requireOwner();
  const user = await requireUser();
  const template = TEMPLATES.find((t) => t.value === formData.get("template"))?.value ?? "quote_form_call";
  const supabase = await createClient();

  const [{ profile, agent }, ctx, { data: ws }] = await Promise.all([
    loadSaved(supabase, workspace.id),
    loadSetupContext(supabase, workspace),
    supabase.from("workspaces").select("phone").eq("id", workspace.id).single(),
  ]);
  // "Miami, FL" from the first service-area ZIP, for the default headline.
  let serviceArea: string | null = null;
  const firstZip = profile?.zip_codes?.[0];
  if (firstZip) {
    const { data: z } = await supabase.from("us_zip_codes").select("city, state").eq("zip", firstZip).maybeSingle();
    if (z) serviceArea = `${z.city}, ${z.state}`;
  }
  const content = defaultContent(template, {
    businessName: workspace.name,
    phone: ws?.phone || formatPhone(agent?.transfer_phone) || null,
    services: (profile?.services ?? []).map((v) => ctx.services.find((s) => s.value === v)?.label ?? v),
    serviceArea,
  });

  // Unique slug: business name, then business-name-2, -3... Slugs are unique across all
  // businesses (and other businesses' pages aren't visible), so let the database decide.
  const base = slugify(workspace.name);
  const label = TEMPLATES.find((t) => t.value === template)!.label;
  let data: { id: string } | null = null;
  for (let n = 1; n <= 50 && !data; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 55)}-${n}`;
    const res = await supabase
      .from("landing_pages")
      .insert({ workspace_id: workspace.id, name: `${label} page`, slug, template, content, created_by: user.id })
      .select("id")
      .single();
    if (res.error && res.error.code !== "23505") throw res.error;
    data = res.data;
  }
  if (!data) throw new Error("Could not find a free web address for this page.");
  redirect(`/landing-pages/${data.id}`);
}

export async function saveLandingPage(_: EditorState, formData: FormData): Promise<EditorState> {
  const workspace = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const template = TEMPLATES.find((t) => t.value === formData.get("template"))?.value as TemplateKey | undefined;
  if (!name) return { error: "Give the page a name." };
  if (!SLUG_PATTERN.test(slug)) return { error: "The web address must be 3-60 lowercase letters, numbers or dashes." };
  if (!template) return { error: "Unknown template." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("content") ?? "{}"));
  } catch {
    return { error: "Could not read the page content." };
  }
  const parsed = contentSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: before } = await supabase.from("landing_pages").select("slug").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!before) return { error: "Page not found." };
  const { error } = await supabase
    .from("landing_pages")
    .update({ name, slug, template, content: parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspace.id);
  if (error) return { error: error.code === "23505" ? "That web address is already taken. Try another." : "Could not save. Please try again." };

  revalidatePath(`/p/${slug}`);
  if (before.slug !== slug) revalidatePath(`/p/${before.slug}`);
  revalidatePath("/landing-pages");
  return { message: "Saved." };
}

export async function setPublished(_: EditorState, formData: FormData): Promise<EditorState> {
  const workspace = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const publish = formData.get("publish") === "true";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("landing_pages")
    .update({ status: publish ? "published" : "draft", published_at: publish ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .select("slug")
    .single();
  if (error || !data) return { error: "Could not change the page status." };
  revalidatePath(`/p/${data.slug}`);
  revalidatePath(`/landing-pages/${id}`);
  revalidatePath("/landing-pages");
  return { message: publish ? "Published - the page is live." : "Unpublished - the page is offline." };
}

export async function deleteLandingPage(formData: FormData) {
  const workspace = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").delete().eq("id", id).eq("workspace_id", workspace.id).select("slug").maybeSingle();
  if (data) revalidatePath(`/p/${data.slug}`);
  revalidatePath("/landing-pages");
  redirect("/landing-pages");
}
