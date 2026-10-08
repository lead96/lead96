"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  FilePlus2,
  LayoutDashboard,
  ListChecks,
  PanelsTopLeft,
  Plug,
  Plus,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui";
import { useDismiss } from "@/components/use-dismiss";

type Item = { href: string; label: string; icon: LucideIcon; badge?: string };

export type SidebarProps = {
  /** Owners see the setup assistant link until setup is finished (then it lives on Business profile). */
  showSetup: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  workspaceName: string;
  role: string;
  /** Called after a link is followed (the mobile drawer closes itself with it). */
  onNavigate?: () => void;
};

/** Quick actions + navigation + business name. Used by the desktop sidebar and the mobile drawer. */
export function SidebarContent({ showSetup, isAdmin, isOwner, workspaceName, role, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const groups: { label?: string; items: Item[] }[] = [
    {
      items: [
        ...(showSetup ? [{ href: "/setup", label: "Setup assistant", icon: ListChecks, badge: "To do" }] : []),
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/leads", label: "Leads", icon: Users },
        { href: "/landing-pages", label: "Landing pages", icon: PanelsTopLeft },
        { href: "/calendar", label: "Calendar", icon: CalendarDays },
      ],
    },
    {
      label: "Business",
      items: [
        { href: "/profile", label: "Business profile", icon: Building2 },
        { href: "/integrations", label: "Integrations", icon: Plug },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
    ...(isAdmin ? [{ label: "Platform", items: [{ href: "/admin", label: "Admin", icon: ShieldCheck }] }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-4">
        <QuickActions isOwner={isOwner} onNavigate={onNavigate} />
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label ? <p className="mb-1 px-3 text-xs font-medium text-slate-400">{g.label}</p> : null}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                      )}
                    >
                      <Icon size={18} strokeWidth={1.75} className={active ? "text-brand-600" : "text-slate-400"} aria-hidden />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{item.badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-5 py-3">
        <p className="truncate text-sm font-medium text-slate-900">{workspaceName}</p>
        <p className="text-xs capitalize text-slate-500">{role}</p>
      </div>
    </div>
  );
}

function QuickActions({ isOwner, onNavigate }: { isOwner: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const actions = [
    { href: "/leads/new", label: "Add lead", icon: UserPlus },
    ...(isOwner
      ? [
          { href: "/leads/import", label: "Import leads (CSV)", icon: Upload },
          { href: "/landing-pages", label: "New landing page", icon: FilePlus2 },
        ]
      : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        <Plus size={18} strokeWidth={2} aria-hidden />
        <span className="flex-1 text-left">Quick actions</span>
        <ChevronDown size={16} aria-hidden className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-slate-200 bg-white p-1 shadow-menu">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <a.icon size={16} strokeWidth={1.75} className="text-slate-400" aria-hidden />
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
