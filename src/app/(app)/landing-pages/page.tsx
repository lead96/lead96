import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { timeAgo } from "@/lib/format";
import { TEMPLATES } from "@/lib/landing/content";
import { createClient } from "@/lib/supabase/server";
import { createLandingPage } from "./actions";

export const metadata: Metadata = { title: "Landing pages" };

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
        <Card className="mb-8 overflow-x-auto">
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
        </Card>
      ) : null}

      {isOwner ? (
        <>
          <h2 className="mb-3 font-semibold text-slate-900">{pages.length ? "Create another page" : "Create your first page"}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {TEMPLATES.map((t) => (
              <Card key={t.value} className="flex flex-col p-5">
                <p className="font-medium text-slate-900">{t.label}</p>
                <p className="mt-1 flex-1 text-sm text-slate-500">{t.description}</p>
                <form action={createLandingPage} className="mt-4">
                  <input type="hidden" name="template" value={t.value} />
                  <Button type="submit" variant="secondary" className="w-full">
                    Use this template
                  </Button>
                </form>
              </Card>
            ))}
          </div>
        </>
      ) : pages.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500">No landing pages yet. The business owner can create them here.</Card>
      ) : null}
    </>
  );
}
