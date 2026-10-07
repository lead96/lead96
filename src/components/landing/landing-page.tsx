"use client";

/**
 * Renders a landing page from its template + content. Used by the public page (/p/[slug])
 * and by the editor's live preview (`preview` disables submitting).
 */
import { startTransition, useActionState, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { submitLandingForm } from "@/app/p/actions";
import { consentText, textOn, type LandingContent, type TemplateKey } from "@/lib/landing/content";

const TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;

type Props = { template: TemplateKey; content: LandingContent; pageId?: string; preview?: boolean };

export function LandingPage({ template, content, pageId, preview = false }: Props) {
  const c = content;
  const style = { "--accent": c.brand_color, "--on-accent": textOn(c.brand_color) } as CSSProperties;
  const telHref = c.phone ? `tel:${c.phone.replace(/[^\d+]/g, "")}` : undefined;

  const callButton = (big = false) =>
    c.phone ? (
      <a
        href={preview ? undefined : telHref}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-(--accent) font-semibold text-(--on-accent) shadow-sm hover:opacity-90 ${big ? "w-full px-6 py-4 text-lg sm:w-auto" : "px-4 py-2 text-sm"}`}
      >
        <span aria-hidden>📞</span> {big && template === "call_first" ? `${c.cta_text} · ${c.phone}` : c.phone}
      </a>
    ) : null;

  return (
    <div style={style} className="min-h-full bg-white text-slate-900">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          {c.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo of unknown size
            <img src={c.logo_url} alt={c.business_name} className="h-9 max-w-[180px] object-contain" />
          ) : (
            <span className="text-lg font-bold">{c.business_name}</span>
          )}
          {callButton()}
        </div>
      </header>

      {template === "seasonal_offer" && c.offer_title ? (
        <div className="bg-(--accent) text-(--on-accent)">
          <div className="mx-auto max-w-5xl px-4 py-3 text-center">
            <p className="text-lg font-bold">{c.offer_title}</p>
            {c.offer_details ? <p className="text-sm opacity-90">{c.offer_details}</p> : null}
            {c.offer_expires ? <p className="mt-0.5 text-xs font-medium uppercase tracking-wide opacity-80">{c.offer_expires}</p> : null}
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        {template === "call_first" ? (
          <section className="mx-auto max-w-2xl text-center">
            <Hero c={c} />
            <div className="mt-6">{callButton(true)}</div>
            <Trust c={c} />
            <div className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 p-5 text-left">
              <p className="mb-3 font-semibold">Prefer a call back?</p>
              <LeadForm c={c} pageId={pageId} preview={preview} fields={["full_name", "phone"]} cta="Call me back" />
            </div>
          </section>
        ) : template === "multi_step_quiz" ? (
          <section className="mx-auto max-w-xl">
            <div className="text-center">
              <Hero c={c} />
            </div>
            <div className="mt-6 rounded-xl border border-slate-200 p-5 shadow-sm">
              <Quiz c={c} pageId={pageId} preview={preview} />
            </div>
            <Trust c={c} />
          </section>
        ) : (
          <section className="grid items-start gap-8 md:grid-cols-[1fr_380px]">
            <div>
              <Hero c={c} align="left" />
              <Trust c={c} align="left" />
              {c.services.length ? (
                <div className="mt-6">
                  <p className="text-sm font-semibold text-slate-700">Services</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {c.services.map((s) => (
                      <li key={s} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c.phone ? <div className="mt-6">{callButton(true)}</div> : null}
            </div>
            <div className="rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="mb-3 font-semibold">{template === "seasonal_offer" ? "Claim the offer" : "Get your free quote"}</p>
              <LeadForm c={c} pageId={pageId} preview={preview} fields={["full_name", "phone", "email", "zip", "service", "message"]} cta={c.cta_text} />
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-slate-500">
          © {new Date().getFullYear()} {c.business_name}
          {c.service_area ? ` · Serving ${c.service_area}` : ""}
        </div>
      </footer>
    </div>
  );
}

function Hero({ c, align = "center" }: { c: LandingContent; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{c.headline}</h1>
      {c.subheadline ? <p className="mt-3 text-base text-slate-600 sm:text-lg">{c.subheadline}</p> : null}
      {c.service_area ? <p className="mt-2 text-sm font-medium text-(--accent)">Serving {c.service_area}</p> : null}
    </div>
  );
}

function Trust({ c, align = "center" }: { c: LandingContent; align?: "center" | "left" }) {
  const points = c.trust_points.filter(Boolean);
  if (!points.length) return null;
  return (
    <ul className={`mt-6 grid grid-cols-2 gap-2 text-sm text-slate-700 ${align === "center" ? "mx-auto max-w-md text-left" : "max-w-md"}`}>
      {points.map((p) => (
        <li key={p} className="flex items-center gap-2">
          <span className="text-(--accent)" aria-hidden>
            ✓
          </span>
          {p}
        </li>
      ))}
    </ul>
  );
}

/** Hidden source fields (UTM, click IDs, page URL, referrer) and the spam timer. */
function useTracking() {
  const [t, setT] = useState<Record<string, string>>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next: Record<string, string> = { page_url: window.location.href, referrer: document.referrer, started_at: String(Date.now()) };
    for (const k of TRACKING_KEYS) if (q.get(k)) next[k] = q.get(k)!;
    // Reading the URL is only possible in the browser, after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setT(next);
  }, []);
  return t;
}

function useSubmit(preview: boolean) {
  const [state, dispatch, pending] = useActionState(submitLandingForm, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (preview) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}

const inputCls =
  "block w-full rounded-md border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent)/20";

type FieldKey = "full_name" | "phone" | "email" | "zip" | "service" | "message";

function LeadForm({ c, pageId, preview, fields, cta }: { c: LandingContent; pageId?: string; preview: boolean; fields: FieldKey[]; cta: string }) {
  const tracking = useTracking();
  const { state, pending, onSubmit } = useSubmit(preview);
  if (state?.ok) return <ThankYou c={c} />;
  const v = (k: string) => state?.fields?.[k] ?? "";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Hidden pageId={pageId} tracking={tracking} />
      {fields.includes("full_name") ? <Labeled label="Name"><input name="full_name" required defaultValue={v("full_name")} autoComplete="name" className={inputCls} /></Labeled> : null}
      {fields.includes("phone") ? <Labeled label="Phone"><input name="phone" type="tel" required defaultValue={v("phone")} autoComplete="tel" className={inputCls} /></Labeled> : null}
      {fields.includes("email") ? <Labeled label="Email (optional)"><input name="email" type="email" defaultValue={v("email")} autoComplete="email" className={inputCls} /></Labeled> : null}
      {fields.includes("zip") ? <Labeled label="ZIP code"><input name="zip" inputMode="numeric" maxLength={10} required defaultValue={v("zip")} autoComplete="postal-code" className={inputCls} /></Labeled> : null}
      {fields.includes("service") && c.services.length ? (
        <Labeled label="What do you need?">
          <select name="service" defaultValue={v("service")} className={inputCls}>
            <option value="">Choose…</option>
            {c.services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Labeled>
      ) : null}
      {fields.includes("message") ? (
        <Labeled label="Anything else? (optional)">
          <textarea name="message" rows={2} maxLength={2000} defaultValue={v("message")} className={inputCls} />
        </Labeled>
      ) : null}
      <Consent c={c} />
      {state?.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-(--accent) px-4 py-3 font-semibold text-(--on-accent) hover:opacity-90 disabled:opacity-60">
        {preview ? `${cta} (preview)` : pending ? "Sending…" : cta}
      </button>
    </form>
  );
}

const URGENCY = ["Emergency — today", "Within a few days", "This month", "Just planning"];

function Quiz({ c, pageId, preview }: { c: LandingContent; pageId?: string; preview: boolean }) {
  const tracking = useTracking();
  const { state, pending, onSubmit } = useSubmit(preview);
  const [step, setStep] = useState(0);
  const [a, setA] = useState<{ service?: string; urgency?: string; homeowner?: string }>({});
  if (state?.ok) return <ThankYou c={c} />;

  const services = c.services.length ? c.services : ["Repair", "Replacement", "Installation", "Maintenance"];
  const steps: { q: string; key: "service" | "urgency" | "homeowner"; options: string[] }[] = [
    { q: "What do you need help with?", key: "service", options: services },
    { q: "How soon do you need it?", key: "urgency", options: URGENCY },
    { q: "Do you own the home?", key: "homeowner", options: ["Yes", "No"] },
  ];
  const total = steps.length + 1;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Hidden pageId={pageId} tracking={tracking} />
      <input type="hidden" name="service" value={a.service ?? ""} />
      <input type="hidden" name="urgency" value={a.urgency ?? ""} />
      <input type="hidden" name="homeowner" value={a.homeowner ?? ""} />
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full bg-(--accent) transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
      {step < steps.length ? (
        <div>
          <p className="mb-3 text-lg font-semibold">{steps[step].q}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {steps[step].options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setA((p) => ({ ...p, [steps[step].key]: o }));
                  setStep((s) => s + 1);
                }}
                className="rounded-lg border border-slate-300 px-4 py-3 text-left font-medium hover:border-(--accent) hover:bg-slate-50"
              >
                {o}
              </button>
            ))}
          </div>
          {step > 0 ? (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="mt-3 text-sm text-slate-500 hover:underline">
              ← Back
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-lg font-semibold">Where should we send your quote?</p>
          <Labeled label="Name"><input name="full_name" required defaultValue={state?.fields?.full_name} autoComplete="name" className={inputCls} /></Labeled>
          <Labeled label="Phone"><input name="phone" type="tel" required defaultValue={state?.fields?.phone} autoComplete="tel" className={inputCls} /></Labeled>
          <Labeled label="ZIP code"><input name="zip" inputMode="numeric" maxLength={10} required defaultValue={state?.fields?.zip} autoComplete="postal-code" className={inputCls} /></Labeled>
          <Labeled label="Email (optional)"><input name="email" type="email" defaultValue={state?.fields?.email} autoComplete="email" className={inputCls} /></Labeled>
          <Consent c={c} />
          {state?.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <button type="submit" disabled={pending} className="w-full rounded-lg bg-(--accent) px-4 py-3 font-semibold text-(--on-accent) hover:opacity-90 disabled:opacity-60">
            {preview ? `${c.cta_text} (preview)` : pending ? "Sending…" : c.cta_text}
          </button>
          <button type="button" onClick={() => setStep((s) => s - 1)} className="text-sm text-slate-500 hover:underline">
            ← Back
          </button>
        </div>
      )}
    </form>
  );
}

function Hidden({ pageId, tracking }: { pageId?: string; tracking: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="page_id" value={pageId ?? ""} />
      {Object.entries(tracking).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      {/* Honeypot: invisible to people, bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company website <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
    </>
  );
}

function Consent({ c }: { c: LandingContent }) {
  return (
    <label className="flex items-start gap-2 text-xs leading-snug text-slate-500">
      <input type="checkbox" name="consent" value="yes" required className="mt-0.5 h-4 w-4 shrink-0 accent-(--accent)" />
      <span>{consentText(c.business_name)}</span>
    </label>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function ThankYou({ c }: { c: LandingContent }) {
  return (
    <div className="py-6 text-center">
      <p className="text-2xl" aria-hidden>
        ✓
      </p>
      <p className="mt-2 text-lg font-semibold">Thank you! We got your request.</p>
      <p className="mt-1 text-sm text-slate-600">{c.business_name} will contact you shortly.</p>
      {c.phone ? <p className="mt-4 text-sm">Need help right now? Call <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-(--accent)">{c.phone}</a></p> : null}
    </div>
  );
}
