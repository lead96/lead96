"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/landing-pages", label: "Landing pages" },
  { href: "/calendar", label: "Calendar" },
  { href: "/integrations", label: "Integrations" },
  { href: "/profile", label: "Business profile" },
  { href: "/settings", label: "Settings" },
];

export function SidebarNav({
  showSetup,
  isAdmin,
  horizontal = false,
}: {
  /** Owners see the setup assistant link until setup is finished (then it lives on Business profile). */
  showSetup: boolean;
  isAdmin: boolean;
  horizontal?: boolean;
}) {
  const pathname = usePathname();
  const links = [
    ...(showSetup ? [{ href: "/setup", label: "Setup assistant" }] : []),
    ...items,
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className={horizontal ? "flex gap-1 overflow-x-auto px-2 py-2" : "flex flex-col gap-0.5 px-3"}>
      {links.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
              horizontal
                ? active
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                : active
                  ? "bg-white/10 font-medium text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
