import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { defaultContent, readContent, type TemplateKey } from "@/lib/landing/content";
import { createClient } from "@/lib/supabase/server";
import { LandingEditor } from "./editor";

export const metadata: Metadata = { title: "Edit landing page" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLandingPage({ params }: PageProps<"/landing-pages/[id]">) {
  const workspace = await requireWorkspace();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("landing_pages")
    .select("id, name, slug, template, content, status")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!page) notFound();
  const template = page.template as TemplateKey;

  return (
    <>
      <PageHeader
        title={page.name}
        actions={
          <Link href="/landing-pages" className="text-sm text-slate-600 hover:underline">
            Back to landing pages
          </Link>
        }
      />
      <LandingEditor
        page={{ id: page.id, name: page.name, slug: page.slug, template, status: page.status as "draft" | "published" }}
        initialContent={readContent(page.content, defaultContent(template, { businessName: workspace.name }))}
        workspaceId={workspace.id}
        baseUrl={publicEnv().NEXT_PUBLIC_APP_URL}
        readOnly={workspace.role !== "owner"}
      />
    </>
  );
}
