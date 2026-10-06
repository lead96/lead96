"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/landing-pages", label: "Landing pages" },
  { href: "/calendar", label: "Calendar" },
  { href: "/integrations", label: "Integrations" },
  { href: "/settings", label: "Settings" },
];

export function SidebarNav({
  isOwner,
  isAdmin,
  horizontal = false,
}: {
  isOwner: boolean;
  isAdmin: boolean;
  horizontal?: boolean;
}) {
  const pathname = usePathname();
  const links = [
    ...(isOwner ? [{ href: "/setup", label: "Setup assistant" }] : []),
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
              active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
