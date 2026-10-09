import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  Inbox,
  LayoutTemplate,
  PhoneCall,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/logo";
import {
  CallPreview,
  CallSummaryChip,
  DashboardPreview,
  RevenuePreview,
} from "@/components/marketing/previews";
import { IconTile, buttonClass, cx } from "@/components/ui";
import { getUser } from "@/lib/auth";
import type { ReactNode } from "react";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

const SOURCES = [
  "Google Ads",
  "Meta Lead Ads",
  "Landing pages",
  "Phone calls",
  "Google Calendar",
  "CSV import",
];

const FEATURES = [
  {
    icon: Inbox,
    title: "One inbox for every lead",
    body: "Google, Meta, landing pages, phone calls and imports land in one place. The same person is merged into one customer.",
  },
  {
    icon: PhoneCall,
    title: "AI calls within a minute",
    body: "Every new lead gets a call inside your contact hours. The AI asks your questions and qualifies the job.",
  },
  {
    icon: CalendarCheck,
    title: "Books real appointments",
    body: "Checks your calendar and daily capacity, books an open slot and sends reminders so people show up.",
  },
  {
    icon: LayoutTemplate,
    title: "Landing pages in minutes",
    body: "Four mobile-first templates with your logo, colors and phone number. Publish with one click.",
  },
  {
    icon: BarChart3,
    title: "Know what makes money",
    body: "Each lead is tracked to the booked job and its revenue, so you see the cost per booking for every campaign.",
  },
  {
    icon: ShieldCheck,
    title: "Consent and records built in",
    body: "Consent is saved with each lead, calls are recorded and transcribed, and your team sees only what they need.",
  },
];

const STEPS = [
  {
    title: "Tell us what you want",
    body: "Type the jobs and area you want. A short chat sets up your services, questions and campaign plan.",
  },
  {
    title: "Leads come in, AI calls",
    body: "Leads from ads, pages and calls arrive in your inbox. The AI calls each one and qualifies it.",
  },
  {
    title: "Jobs get booked",
    body: "Qualified leads are booked into your calendar, and you see which ads bring real revenue.",
  },
];

const FAQ = [
  {
    q: "Do I need to know how to run ads?",
    a: "No. You tell us the jobs and area you want, and the setup chat builds the plan. We handle the ad side; you handle the jobs.",
  },
  {
    q: "Which lead sources work with Lead96?",
    a: "Google Ads lead forms, Meta (Facebook and Instagram) lead ads, Lead96 landing pages, phone calls and CSV imports of older leads.",
  },
  {
    q: "How fast does the AI call a new lead?",
    a: "Within about a minute, inside the contact hours you set. If nobody answers, it follows up by text and tries again later.",
  },
  {
    q: "What does the AI ask on the call?",
    a: "Your own qualification questions - service, area, urgency, property type and anything else you add. You can change them anytime.",
  },
  {
    q: "Can my office staff use it?",
    a: "Yes. Invite your team: they work the lead inbox, calls and appointments without access to billing or integrations.",
  },
];

function IntentForm({
  id,
  tone = "light",
}: {
  id: string;
  tone?: "light" | "dark";
}) {
  return (
    <form
      action="/signup"
      method="get"
      className={cx(
        "flex w-full flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:items-center",
        tone === "light"
          ? "bg-white shadow-sm ring-1 ring-slate-200"
          : "bg-white/10 ring-1 ring-white/20",
      )}
    >
      <label htmlFor={id} className="sr-only">
        What leads do you want?
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
        <Search
          size={18}
          className={
            tone === "light"
              ? "shrink-0 text-slate-400"
              : "shrink-0 text-white/70"
          }
          aria-hidden
        />
        <input
          id={id}
          name="q"
          required
          maxLength={500}
          placeholder="e.g. AC repair leads in Dallas 75201"
          className={cx(
            "h-12 w-full min-w-0 bg-transparent text-base outline-none",
            tone === "light"
              ? "text-slate-900 placeholder:text-slate-400"
              : "text-white placeholder:text-white/60",
          )}
        />
      </div>
      <button
        type="submit"
        className={cx(
          "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2",
          tone === "light"
            ? "bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-600/30"
            : "bg-white text-brand-700 hover:bg-brand-50 focus-visible:ring-white/40",
        )}
      >
        Get my leads
        <ArrowRight size={16} aria-hidden />
      </button>
    </form>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-brand-600">{children}</p>;
}

export default async function HomePage() {
  const user = await getUser();

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo height={28} />
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="transition-colors hover:text-slate-900"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                href="/dashboard"
                className={buttonClass("primary", undefined, "sm")}
              >
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={buttonClass("ghost", undefined, "sm")}
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className={buttonClass("primary", undefined, "sm")}
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="hero-grid pointer-events-none absolute inset-0"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-card">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                For HVAC and home-service contractors
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-900 sm:text-6xl sm:leading-[1.05]">
                Turn every lead into a{" "}
                <span className="text-brand-600">booked job</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
                Lead96 collects your leads, calls each one within a minute with
                AI, books the appointment in your calendar - and shows which ads
                bring real revenue.
              </p>
              <div className="mx-auto mt-9 max-w-xl">
                <IntentForm id="q" />
              </div>
              <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
                {[
                  "Free setup",
                  "No ad skills needed",
                  "Google and Meta in one inbox",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check size={16} className="text-emerald-600" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
              <DashboardPreview />
              <div className="absolute -bottom-10 -left-10 hidden lg:block">
                <CallSummaryChip />
              </div>
            </div>
          </div>
        </section>

        {/* Sources */}
        <section className="border-y border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-slate-400">
              Works with where your leads already come from
            </p>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {SOURCES.map((s) => (
                <li key={s} className="text-base font-semibold text-slate-400">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>Everything in one place</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                From ad click to booked job
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                No more leads lost in email, missed calls or spreadsheets.
                Lead96 answers fast and keeps the whole story of every customer.
              </p>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card transition-colors hover:border-brand-200"
                >
                  <IconTile icon={f.icon} />
                  <h3 className="mt-5 text-base font-semibold text-slate-900">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Spotlights */}
        <section className="bg-page">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
            <div>
              <Eyebrow>Speed to lead</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                The first company to call usually wins the job
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Homeowners ask several contractors at once. Lead96 calls back
                while they are still on the phone, asks your questions and books
                the visit.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-700">
                {[
                  "Calls only inside the hours and area you set",
                  "Hands the call to your team when the caller asks",
                  "Summary, recording and answers saved to the customer",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check
                      size={18}
                      className="mt-px shrink-0 text-emerald-600"
                      aria-hidden
                    />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <CallPreview />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 sm:px-6 sm:pb-24 lg:grid-cols-2 lg:gap-16">
            <div className="lg:order-2">
              <Eyebrow>Revenue, not clicks</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                See which ads bring paying customers
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Every lead keeps its source - campaign, ad and landing page -
                all the way to the booked job and its revenue. Spend more where
                it pays and stop what doesn&apos;t.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-700">
                {[
                  "Cost per lead and cost per booked job",
                  "Booking rate per campaign",
                  "Ad spend from Google and Meta pulled in daily",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check
                      size={18}
                      className="mt-px shrink-0 text-emerald-600"
                      aria-hidden
                    />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:order-1">
              <RevenuePreview />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Three steps to booked jobs
              </h2>
            </div>
            <div className="relative mt-14">
              <div
                aria-hidden
                className="absolute left-[16.66%] right-[16.66%] top-5 hidden h-px bg-slate-200 md:block"
              />
              <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative text-center">
                    <span className="relative mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white ring-8 ring-white">
                      {i + 1}
                    </span>
                    <h3 className="mt-5 text-base font-semibold text-slate-900">
                      {s.title}
                    </h3>
                    <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
                      {s.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-slate-100">
          <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
            <div className="text-center">
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Questions contractors ask
              </h2>
            </div>
            <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <Plus
                      size={18}
                      className="shrink-0 text-slate-400 transition-transform group-open:rotate-45"
                      aria-hidden
                    />
                  </summary>
                  <p className="mt-3 pr-8 text-sm leading-relaxed text-slate-600">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="px-4 pb-20 sm:px-6 sm:pb-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-700 px-6 py-14 text-center sm:px-12 sm:py-20">
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Ready for more booked jobs?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-brand-100">
                Tell us the leads you want. Setup takes a few minutes and is
                free.
              </p>
              <div className="mx-auto mt-8 max-w-xl">
                <IntentForm id="q-bottom" tone="dark" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Logo height={24} />
            <p className="mt-3 text-sm text-slate-500">
              Leads, AI calls, bookings and revenue for home-service
              contractors.
            </p>
          </div>
          <div className="flex gap-16 text-sm">
            <div>
              <p className="font-medium text-slate-900">Product</p>
              <ul className="mt-3 space-y-2 text-slate-500">
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className="hover:text-slate-900">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-slate-900">Account</p>
              <ul className="mt-3 space-y-2 text-slate-500">
                <li>
                  <Link href="/login" className="hover:text-slate-900">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/signup" className="hover:text-slate-900">
                    Get started
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-6xl border-t border-slate-100 px-4 py-6 text-xs text-slate-400 sm:px-6">
          © {new Date().getFullYear()} Lead96. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
