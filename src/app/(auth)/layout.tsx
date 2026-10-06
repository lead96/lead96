import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold text-slate-900">
        LeadGen <span className="text-brand-600">OS</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
