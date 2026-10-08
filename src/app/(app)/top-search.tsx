"use client";

import Form from "next/form";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

/** Lead search in the top bar. Hidden on the inbox itself, which has its own search and filters. */
export function TopSearch() {
  const pathname = usePathname();
  if (pathname === "/leads") return null;
  return (
    <Form action="/leads" role="search" className="relative hidden w-full max-w-sm md:block">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        name="q"
        type="search"
        placeholder="Search leads by name, phone or email"
        aria-label="Search leads"
        className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/20"
      />
    </Form>
  );
}
