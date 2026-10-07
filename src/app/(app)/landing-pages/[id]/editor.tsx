"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { LandingPage } from "@/components/landing/landing-page";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { TEMPLATES, type LandingContent, type TemplateKey } from "@/lib/landing/content";
import { createClient } from "@/lib/supabase/client";
import { deleteLandingPage, saveLandingPage, setPublished } from "../actions";

type PageInfo = { id: string; name: string; slug: string; template: TemplateKey; status: "draft" | "published" };

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function LandingEditor({
  page,
  initialContent,
  workspaceId,
  baseUrl,
  readOnly,
}: {
  page: PageInfo;
  initialContent: LandingContent;
  workspaceId: string;
  baseUrl: string;
  readOnly: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const [name, setName] = useState(page.name);
  const [slug, setSlug] = useState(page.slug);
  const [template, setTemplate] = useState<TemplateKey>(page.template);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [dirty, setDirty] = useState(false);
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [saveState, save, saving] = useActionState(saveLandingPage, undefined);
  const [pubState, publish, publishing] = useActionState(setPublished, undefined);

  const set = <K extends keyof LandingContent>(k: K, v: LandingContent[K]) => {
    setContent((c) => ({ ...c, [k]: v }));
    setDirty(true);
  };
  const live = page.status === "published";
  const publicUrl = `${baseUrl.replace(/\/$/, "")}/p/${page.slug}`;

  const onSave = () => {
    const data = new FormData();
    data.set("id", page.id);
    data.set("name", name);
    data.set("slug", slug);
    data.set("template", template);
    data.set("content", JSON.stringify(content));
    startTransition(() => save(data));
    setDirty(false);
  };
  const onPublish = (next: boolean) => {
    const data = new FormData();
    data.set("id", page.id);
    data.set("publish", String(next));
    startTransition(() => publish(data));
  };

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return setUpload({ busy: false, error: "Logo must be under 2 MB." });
    setUpload({ busy: true });
    const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("landing-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return setUpload({ busy: false, error: "Upload failed. Use a PNG, JPG, WebP or SVG under 2 MB." });
    set("logo_url", supabase.storage.from("landing-assets").getPublicUrl(path).data.publicUrl);
    setUpload({ busy: false });
  };

  const status = saveState?.error || pubState?.error ? (
    <Alert tone="error">{saveState?.error || pubState?.error}</Alert>
  ) : saveState?.message || pubState?.message ? (
    <Alert tone="success">{pubState?.message || saveState?.message}</Alert>
  ) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <Badge tone={live ? "green" : "slate"}>{live ? "Live" : "Draft"}</Badge>
            {live ? (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="truncate pl-3 text-sm text-brand-700 hover:underline">
                Open live page ↗
              </a>
            ) : null}
          </div>
          {live ? <p className="break-all rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{publicUrl}</p> : null}
          {status}
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : dirty ? "Save changes" : "Save"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => onPublish(!live)} disabled={publishing || dirty}>
                {publishing ? "…" : live ? "Unpublish" : "Publish"}
              </Button>
            </div>
          ) : null}
          {dirty && !readOnly ? <p className="text-xs text-amber-700">You have unsaved changes. Save before publishing.</p> : null}
        </Card>

        <fieldset disabled={readOnly} className="space-y-4">
          <Section title="Page">
            <Field label="Page name (only you see this)" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} maxLength={80} />
            </Field>
            <Field label="Web address" htmlFor="slug" hint="Lowercase letters, numbers and dashes.">
              <div className="flex items-center gap-1 text-sm text-slate-500">
                <span className="shrink-0">/p/</span>
                <Input id="slug" value={slug} onChange={(e) => (setSlug(e.target.value.toLowerCase()), setDirty(true))} maxLength={60} />
              </div>
            </Field>
            <Field label="Template" htmlFor="template">
              <Select id="template" value={template} onChange={(e) => (setTemplate(e.target.value as TemplateKey), setDirty(true))}>
                {TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          <Section title="Business">
            <Field label="Business name" htmlFor="business_name">
              <Input id="business_name" value={content.business_name} onChange={(e) => set("business_name", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Phone number" htmlFor="phone" hint="Shown as a tap-to-call button. Tracking numbers come with the AI call setup.">
              <Input id="phone" type="tel" value={content.phone} onChange={(e) => set("phone", e.target.value)} maxLength={20} />
            </Field>
            <Field label="Logo" htmlFor="logo">
              <div className="flex items-center gap-3">
                {content.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                  <img src={content.logo_url} alt="" className="h-10 max-w-[120px] rounded border border-slate-200 object-contain" />
                ) : null}
                <input id="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => onLogo(e.target.files?.[0])} className="text-sm" />
              </div>
              {upload.busy ? <p className="text-xs text-slate-500">Uploading…</p> : null}
              {upload.error ? <p className="text-xs text-red-600">{upload.error}</p> : null}
              {content.logo_url ? (
                <button type="button" onClick={() => set("logo_url", "")} className="text-xs text-slate-500 hover:underline">
                  Remove logo
                </button>
              ) : null}
            </Field>
            <Field label="Brand color" htmlFor="brand_color">
              <div className="flex items-center gap-2">
                <input id="brand_color" type="color" value={content.brand_color} onChange={(e) => set("brand_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" />
                <Input value={content.brand_color} onChange={(e) => set("brand_color", e.target.value)} maxLength={7} className="w-28 font-mono" aria-label="Brand color hex" />
              </div>
            </Field>
            <Field label="Service area" htmlFor="service_area" hint="e.g. “Miami and 20 miles around”">
              <Input id="service_area" value={content.service_area} onChange={(e) => set("service_area", e.target.value)} maxLength={100} />
            </Field>
          </Section>

          <Section title="Text">
            <Field label="Headline" htmlFor="headline">
              <Input id="headline" value={content.headline} onChange={(e) => set("headline", e.target.value)} maxLength={90} />
            </Field>
            <Field label="Sub-headline" htmlFor="subheadline">
              <textarea
                id="subheadline"
                value={content.subheadline}
                onChange={(e) => set("subheadline", e.target.value)}
                maxLength={200}
                rows={2}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </Field>
            <Field label="Button text" htmlFor="cta_text">
              <Input id="cta_text" value={content.cta_text} onChange={(e) => set("cta_text", e.target.value)} maxLength={30} />
            </Field>
            <ListField label="Trust points (up to 4)" values={content.trust_points} max={4} maxLength={60} onChange={(v) => set("trust_points", v)} />
            <ListField label="Services shown (up to 8)" values={content.services} max={8} maxLength={40} onChange={(v) => set("services", v)} />
          </Section>

          {template === "seasonal_offer" ? (
            <Section title="Offer">
              <Field label="Offer title" htmlFor="offer_title">
                <Input id="offer_title" value={content.offer_title} onChange={(e) => set("offer_title", e.target.value)} maxLength={60} />
              </Field>
              <Field label="Offer details" htmlFor="offer_details">
                <Input id="offer_details" value={content.offer_details} onChange={(e) => set("offer_details", e.target.value)} maxLength={160} />
              </Field>
              <Field label="Expires" htmlFor="offer_expires" hint="e.g. “Ends October 31”">
                <Input id="offer_expires" value={content.offer_expires} onChange={(e) => set("offer_expires", e.target.value)} maxLength={40} />
              </Field>
            </Section>
          ) : null}
        </fieldset>

        {!readOnly ? (
          <form
            action={deleteLandingPage}
            onSubmit={(e) => {
              if (!confirm("Delete this landing page? Leads it already collected are kept.")) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={page.id} />
            <button type="submit" className="text-sm text-red-600 hover:underline">
              Delete page
            </button>
          </form>
        ) : null}
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Preview</p>
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            {(["mobile", "desktop"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                className={`rounded px-2.5 py-1 capitalize ${device === d ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3">
          <div className={`mx-auto max-h-[78vh] overflow-y-auto rounded-md bg-white shadow ${device === "mobile" ? "max-w-[390px]" : "w-full"}`}>
            <LandingPage template={template} content={content} preview />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

function ListField({ label, values, max, maxLength, onChange }: { label: string; values: string[]; max: number; maxLength: number; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input value={v} maxLength={maxLength} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} ${i + 1}`} />
          <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
            Remove
          </button>
        </div>
      ))}
      {values.length < max ? (
        <button type="button" onClick={() => onChange([...values, ""])} className="text-sm font-medium text-brand-600 hover:underline">
          + Add
        </button>
      ) : null}
    </div>
  );
}
