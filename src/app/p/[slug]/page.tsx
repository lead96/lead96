import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { LandingPage } from "@/components/landing/landing-page";
import { SLUG_PATTERN, defaultContent, readContent, type TemplateKey } from "@/lib/landing/content";
import { createAdminClient } from "@/lib/supabase/server";

/** Public landing page. Only published pages are shown; drafts 404. */
const loadPage = cache(async (slug: string) => {
  if (!SLUG_PATTERN.test(slug)) return null;
  const { data } = await createAdminClient()
    .from("landing_pages")
    .select("id, name, template, content, status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return null;
  const template = data.template as TemplateKey;
  return { id: data.id as string, template, content: readContent(data.content, defaultContent(template, { businessName: data.name })) };
});

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const page = await loadPage((await params).slug);
  if (!page) return { title: "Page not found" };
  return {
    title: { absolute: `${page.content.headline} | ${page.content.business_name}` },
    description: page.content.subheadline || undefined,
    icons: page.content.logo_url ? { icon: page.content.logo_url } : undefined,
  };
}

export default async function PublicLandingPage({ params }: PageProps<"/p/[slug]">) {
  const page = await loadPage((await params).slug);
  if (!page) notFound();
  return <LandingPage template={page.template} content={page.content} pageId={page.id} />;
}
