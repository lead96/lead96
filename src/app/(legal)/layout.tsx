import Link from "next/link";
import { Logo } from "@/components/logo";
import { COMPANY } from "@/lib/legal";

/** Public legal pages: simple header, readable text column, links between the pages. */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200/70">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Logo height={26} />
          <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
            Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">{children}</main>
      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500 sm:px-6">
          <span>
            © {new Date().getFullYear()} {COMPANY.legalName}
          </span>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-900">
              Terms
            </Link>
            <Link href="/imprint" className="hover:text-slate-900">
              Imprint
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
