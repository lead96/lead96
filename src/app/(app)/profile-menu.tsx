"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Building2, ChevronDown, LogOut, Settings, ShieldCheck } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { cx } from "@/components/ui";
import { useDismiss } from "@/components/use-dismiss";

export function ProfileMenu({ name, email, workspaceName, role, isAdmin }: { name: string; email: string; workspaceName: string; role: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const links = [
    { href: "/profile", label: "Business profile", icon: Building2 },
    { href: "/settings", label: "Settings", icon: Settings },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-lg p-1 pr-1.5 hover:bg-slate-100 sm:pr-2"
      >
        <Avatar name={name} />
        <span className="hidden max-w-[160px] truncate text-sm font-medium text-slate-700 sm:block">{name}</span>
        <ChevronDown size={16} aria-hidden className={cx("hidden text-slate-400 transition-transform sm:block", open && "rotate-180")} />
      </button>

      {open ? (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-menu">
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar name={name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
              <p className="truncate text-xs text-slate-500">{email}</p>
            </div>
          </div>
          <div className="mx-3 mb-1 rounded-lg bg-slate-50 px-3 py-2">
            <p className="truncate text-xs font-medium text-slate-700">{workspaceName}</p>
            <p className="text-xs capitalize text-slate-500">{role}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <l.icon size={16} strokeWidth={1.75} className="text-slate-400" aria-hidden />
              {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <form action={logout}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <LogOut size={16} strokeWidth={1.75} className="text-slate-400" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-semibold text-white",
        size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs",
      )}
    >
      {initials}
    </span>
  );
}
