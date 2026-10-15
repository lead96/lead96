import type { ReactNode } from "react";
import { LEGAL_UPDATED } from "@/lib/legal";

/** Building blocks for the legal pages: a readable column without a typography plugin. */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="text-[15px] leading-relaxed text-slate-700">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: {LEGAL_UPDATED}</p>
      {intro ? <div className="mt-6 space-y-3">{intro}</div> : null}
      <div className="mt-8 space-y-8">{children}</div>
    </article>
  );
}

export function Clause({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
