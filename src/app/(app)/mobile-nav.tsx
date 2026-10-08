"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { SidebarContent, type SidebarProps } from "./sidebar-nav";

/** Hamburger button + slide-in navigation drawer for phones and small tablets. */
export function MobileNav(props: Omit<SidebarProps, "onNavigate">) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Rendered into <body>: the sticky header uses backdrop-blur, which would trap a fixed drawer inside it.
  const drawer = (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-slate-900/30" onClick={close} aria-hidden />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-menu">
        <div className="flex items-center justify-between px-5 py-4">
          <Logo height={24} href="/dashboard" />
          <button type="button" onClick={close} aria-label="Close menu" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={20} aria-hidden />
          </button>
        </div>
        <SidebarContent {...props} onNavigate={close} />
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="-ml-1.5 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden />
      </button>
      {open ? createPortal(drawer, document.body) : null}
    </>
  );
}
