import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button, Input, buttonClass } from "@/components/ui";
import { getUser } from "@/lib/auth";

const steps = [
  { title: "Tell us what you want", body: "Type the jobs and area you want. We ask a few simple questions — no ad skills needed." },
  { title: "AI calls every lead", body: "New leads get a call within a minute. The AI qualifies them and books real slots in your calendar." },
  { title: "See what makes money", body: "Every lead is tracked to the booked job and revenue, so you know your cost per booked appointment." },
];

export default async function HomePage() {
  const user = await getUser();

  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo height={32} />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className={buttonClass()}>
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost")}>
                Sign in
              </Link>
              <Link href="/signup" className={buttonClass()}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pb-16 pt-12 text-center sm:pt-20">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            More booked jobs from every lead.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-600 sm:text-lg">
            Tell us what leads you want. Our AI calls every lead, qualifies it and books the appointment — and you see
            which ads bring real revenue.
          </p>

          <form action="/signup" method="get" className="mx-auto mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
            <label htmlFor="q" className="sr-only">
              What leads do you want?
            </label>
            <Input
              id="q"
              name="q"
              required
              maxLength={500}
              placeholder="e.g. AC repair leads in Dallas 75201"
              className="h-12 text-base"
            />
            <Button type="submit" className="h-12 shrink-0 px-6">
              Get my leads
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Free setup. Connect your own Google and Meta accounts.</p>
        </section>

        <section className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {i + 1}
                </div>
                <h2 className="mt-3 font-semibold text-slate-900">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-400">© {new Date().getFullYear()} Lead96</footer>
    </div>
  );
}
