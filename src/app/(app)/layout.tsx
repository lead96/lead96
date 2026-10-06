import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { getProfile, requireWorkspace } from "@/lib/auth";
import { SidebarNav } from "./sidebar-nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const workspace = await requireWorkspace();
  const profile = await getProfile();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Link href="/dashboard" className="px-5 py-5 text-lg font-semibold text-slate-900">
          LeadGen <span className="text-brand-600">OS</span>
        </Link>
        <SidebarNav isOwner={workspace.role === "owner"} isAdmin={Boolean(profile?.is_platform_admin)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{workspace.name}</div>
            <div className="text-xs capitalize text-slate-500">{workspace.role}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{profile?.email}</span>
            <form action={logout}>
              <button type="submit" className="text-sm text-slate-600 hover:text-slate-900">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="border-b border-slate-200 bg-white md:hidden">
          <SidebarNav isOwner={workspace.role === "owner"} isAdmin={Boolean(profile?.is_platform_admin)} horizontal />
        </div>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
