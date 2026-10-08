import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Logo } from "@/components/logo";
import { getProfile, requireWorkspace } from "@/lib/auth";
import { MobileNav } from "./mobile-nav";
import { ProfileMenu } from "./profile-menu";
import { SidebarContent } from "./sidebar-nav";
import { TopSearch } from "./top-search";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [workspace, profile] = await Promise.all([requireWorkspace(), getProfile()]);
  const nav = {
    showSetup: workspace.role === "owner" && !workspace.setupCompletedAt,
    isAdmin: Boolean(profile?.is_platform_admin),
    isOwner: workspace.role === "owner",
    workspaceName: workspace.name,
    role: workspace.role,
  };
  const email = profile?.email ?? "";
  const name = profile?.full_name?.trim() || email.split("@")[0] || "Account";

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="px-6 py-5">
            <Logo height={26} href="/dashboard" />
          </div>
          <SidebarContent {...nav} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur-sm md:px-10">
          <MobileNav {...nav} />
          <div className="md:hidden">
            <Logo height={22} href="/dashboard" />
          </div>

          <TopSearch />

          <div className="ml-auto flex items-center gap-2">
            {nav.showSetup ? (
              <Link
                href="/setup"
                className="hidden items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 sm:inline-flex"
              >
                <ListChecks size={16} aria-hidden />
                Finish setup
              </Link>
            ) : null}
            <ProfileMenu name={name} email={email} workspaceName={workspace.name} role={workspace.role} isAdmin={nav.isAdmin} />
          </div>
        </header>

        <main className="flex-1 px-5 py-8 md:px-10 md:py-10">
          <div className="mx-auto w-full max-w-[1200px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
