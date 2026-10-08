import Link from "next/link";
import type { Metadata } from "next";
import { ClipboardList, FileText, PanelsTopLeft, Phone, Tag } from "lucide-react";
import { Badge, Button, Card, EmptyState, IconTile, PageHeader, Section, type Icon } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { timeAgo } from "@/lib/format";
import { TEMPLATES } from "@/lib/landing/content";
import { createClient } from "@/lib/supabase/server";
import { createLandingPage } from "./actions";

export const metadata: Metadata = { title: "Landing pages" };

const TEMPLATE_ICONS: Record<string, Icon> = {
  call_first: Phone,
  quote_form_call: FileText,
  multi_step_quiz: ClipboardList,
  seasonal_offer: Tag,
};

type Page = { id: string; name: string; slug: string; template: string; status: string; updated_at: string };

export default async function LandingPagesPage() {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const supabase = await createClient();
  const [{ data }, { data: counts }] = await Promise.all([
    supabase.from("landing_pages").select("id, name, slug, template, status, updated_at").eq("workspace_id", workspace.id).order("created_at"),
    supabase.from("leads").select("landing_page_id").eq("workspace_id", workspace.id).not("landing_page_id", "is", null).limit(5000),
  ]);
  const pages = (data ?? []) as Page[];
  const leadsByPage = new Map<string, number>();
  for (const r of counts ?? []) leadsByPage.set(r.landing_page_id as string, (leadsByPage.get(r.landing_page_id as string) ?? 0) + 1);
  const base = publicEnv().NEXT_PUBLIC_APP_URL;

  return (
    <>
      <PageHeader title="Landing pages" description="Mobile-friendly pages for your ads. Every form and call goes straight into your lead inbox." />

      {pages.length ? (
        <Card className="mb-12 overflow-hidden">
          {/* Phones: one row per page. */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {pages.map((p) => (
              <li key={p.id}>
                <Link href={`/landing-pages/${p.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {TEMPLATES.find((t) => t.value === p.template)?.label} · {leadsByPage.get(p.id) ?? 0} leads
                    </span>
                  </span>
                  <Badge tone={p.status === "published" ? "green" : "slate"}>{p.status === "published" ? "Live" : "Draft"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Page</th>
                  <th className="px-4 py-2.5 font-medium">Template</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/landing-pages/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {p.status === "published" ? (
                          <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="hover:underline">
                            {`${base.replace(/^https?:\/\//, "")}/p/${p.slug}`}
                          </a>
                        ) : (
                          `/p/${p.slug}`
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{TEMPLATES.find((t) => t.value === p.template)?.label}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={p.status === "published" ? "green" : "slate"}>{p.status === "published" ? "Live" : "Draft"}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{leadsByPage.get(p.id) ?? 0}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{timeAgo(p.updated_at, workspace.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {isOwner ? (
        <Section
          title={pages.length ? "Create another page" : "Create your first page"}
          description="Start from a template. You can change the text, colors and logo before publishing."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {TEMPLATES.map((t) => (
              <Card key={t.value} className="flex flex-col p-5 transition-colors hover:border-brand-200">
                <div className="flex items-center gap-3">
                  <IconTile icon={TEMPLATE_ICONS[t.value] ?? PanelsTopLeft} size="sm" />
                  <p className="text-sm font-semibold text-slate-900">{t.label}</p>
                </div>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-slate-500">{t.description}</p>
                <form action={createLandingPage} className="mt-4">
                  <input type="hidden" name="template" value={t.value} />
                  <Button type="submit" variant="secondary" size="sm">
                    Use template
                  </Button>
                </form>
              </Card>
            ))}
          </div>
        </Section>
      ) : pages.length === 0 ? (
        <Card>
          <EmptyState icon={PanelsTopLeft} title="No landing pages yet" description="The business owner can create landing pages here from ready-made templates." />
        </Card>
      ) : null}
    </>
  );
}
