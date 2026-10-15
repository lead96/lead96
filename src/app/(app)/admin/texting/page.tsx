import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { consentText } from "@/lib/landing/content";
import { formatUsPhone } from "@/lib/setup/draft";
import { createAdminClient } from "@/lib/supabase/server";
import { BUSINESS_TYPES, campaignText, STATUS_LABELS, type BusinessType, type Registration, type TextingStatus } from "@/lib/texting/registration";
import { CopyField } from "../google/forms";
import { TextingStatusForm } from "./forms";

export const metadata: Metadata = { title: "Texting registrations" };

const TZ = "America/New_York";
const ORDER: TextingStatus[] = ["submitted", "rejected", "in_review", "approved", "draft"];

type Row = Registration & {
  workspace_id: string;
  status: TextingStatus;
  admin_note: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  updated_at: string;
};

export default async function TextingRegistrationsPage() {
  const profile = await getProfile();
  if (!profile?.is_platform_admin) redirect("/dashboard");

  const db = createAdminClient();
  const { data } = await db.from("texting_registrations").select("*");
  const rows = ((data ?? []) as Row[]).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at));
  const ids = rows.map((r) => r.workspace_id);
  const [{ data: businesses }, { data: owners }, { data: numbers }, { data: pages }] = ids.length
    ? await Promise.all([
        db.from("workspaces").select("id, name").in("id", ids),
        db.from("workspace_members").select("workspace_id, profiles (email)").in("workspace_id", ids).eq("role", "owner"),
        db.from("phone_numbers").select("workspace_id, e164").in("workspace_id", ids),
        db.from("landing_pages").select("workspace_id, slug").in("workspace_id", ids).eq("status", "published").order("published_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const nameOf = new Map((businesses ?? []).map((b) => [b.id, b.name as string]));
  const ownerOf = new Map<string, string[]>();
  for (const o of (owners ?? []) as unknown as { workspace_id: string; profiles: { email: string | null } | null }[]) {
    if (o.profiles?.email) ownerOf.set(o.workspace_id, [...(ownerOf.get(o.workspace_id) ?? []), o.profiles.email]);
  }
  const pageOf = new Map<string, string>();
  for (const p of pages ?? []) if (!pageOf.has(p.workspace_id)) pageOf.set(p.workspace_id, p.slug);

  return (
    <>
      <PageHeader
        title="Texting registrations"
        description="US SMS registration (A2P 10DLC) per business. File each one in Retell: Phone Numbers > the business's number > SMS (business profile, low-volume brand, campaign)."
        actions={
          <Link href="/admin" className="text-sm font-medium text-brand-700 hover:underline">
            Back to admin
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No registrations yet" description="Owners send their details from Settings > Texting." />
      ) : (
        <div className="space-y-6">
          {rows.map((r) => {
            const name = nameOf.get(r.workspace_id) ?? "Deleted business";
            const formUrl = pageOf.has(r.workspace_id) ? `https://lead96.com/p/${pageOf.get(r.workspace_id)}` : null;
            const campaign = campaignText({
              brand: r.brand_name || name,
              legalName: r.legal_name,
              formUrl: formUrl ?? "https://lead96.com/p/<business>",
              consent: consentText(r.brand_name || name),
            });
            const nums = (numbers ?? []).filter((n) => n.workspace_id === r.workspace_id).map((n) => formatUsPhone(n.e164));
            const s = STATUS_LABELS[r.status];
            return (
              <Card key={r.workspace_id} className="p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">{name}</h2>
                    <p className="text-xs text-slate-500">
                      {(ownerOf.get(r.workspace_id) ?? []).join(", ") || "no owner"}
                      {r.submitted_at ? ` · sent ${formatDateTime(r.submitted_at, TZ)} ET` : ""}
                      {r.decided_at ? ` · decided ${formatDateTime(r.decided_at, TZ)} ET` : ""}
                    </p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>

                {r.status === "draft" ? (
                  <p className="text-sm text-slate-500">The owner saved a draft and has not sent it yet.</p>
                ) : (
                  <div className="space-y-6">
                    <p className="text-sm text-slate-600">
                      Number to register: <span className="font-medium tabular-nums text-slate-900">{nums.join(", ") || "none assigned yet (buy one on AI voice)"}</span>
                      {formUrl ? null : <span className="text-amber-700"> · No published landing page: publish one before filing (the opt-in proof).</span>}
                    </p>

                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Business profile and brand</h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        <CopyField label="Legal business name" value={r.legal_name} />
                        <CopyField label="Brand / DBA" value={r.brand_name || name} />
                        <CopyField label="Business type" value={BUSINESS_TYPES[r.business_type as BusinessType] ?? r.business_type} />
                        <CopyField label="EIN" value={r.ein} />
                        <CopyField label="Website" value={r.website} />
                        <CopyField label="Address" value={`${r.street}, ${r.city}, ${r.state} ${r.zip}`} />
                        <CopyField label="Contact" value={`${r.contact_first_name} ${r.contact_last_name}, ${r.contact_title}`} />
                        <CopyField label="Contact email" value={r.contact_email} />
                        <CopyField label="Contact phone" value={formatUsPhone(r.contact_phone)} />
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign</h3>
                      <div className="grid gap-3">
                        <CopyField label="Use case" value={campaign.useCase} />
                        <CopyField label="Description" value={campaign.description} />
                        <CopyField label="Sample message 1" value={campaign.sample1} />
                        <CopyField label="Sample message 2" value={campaign.sample2} />
                        <CopyField label="How do end-users consent?" value={campaign.optIn} />
                        <div className="grid gap-3 md:grid-cols-2">
                          <CopyField label="Privacy policy URL" value={campaign.privacyUrl} />
                          <CopyField label="Terms URL" value={campaign.termsUrl} />
                        </div>
                      </div>
                    </section>

                    <section className="border-t border-slate-100 pt-4">
                      <TextingStatusForm workspaceId={r.workspace_id} status={r.status} note={r.admin_note} />
                    </section>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
