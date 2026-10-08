import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeMember, revokeInvite } from "./actions";
import { BusinessForm, InviteForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const isOwner = workspace.role === "owner";
  const supabase = await createClient();

  const [{ data: business }, { data: members }, { data: invites }] = await Promise.all([
    supabase.from("workspaces").select("name, timezone, phone, website").eq("id", workspace.id).single(),
    supabase
      .from("workspace_members")
      .select("user_id, role, profiles (email, full_name)")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    isOwner
      ? supabase
          .from("workspace_invites")
          .select("id, email, role, expires_at")
          .eq("workspace_id", workspace.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Business details and team." />

      <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Business</h2>
          {business ? <BusinessForm business={business} disabled={!isOwner} /> : null}
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold text-slate-900">Team</h2>
          <ul className="divide-y divide-slate-100">
            {(members ?? []).map((m) => {
              const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p?.full_name || p?.email}</p>
                    <p className="truncate text-xs text-slate-500">
                      {p?.email} · <span className="capitalize">{m.role}</span>
                    </p>
                  </div>
                  {isOwner && m.role !== "owner" ? (
                    <form action={removeMember}>
                      <input type="hidden" name="userId" value={m.user_id} />
                      <button className="text-xs text-red-600 hover:underline">Remove</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {isOwner ? (
            <>
              {invites && invites.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Pending invites</p>
                  <ul className="divide-y divide-slate-100">
                    {invites.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-slate-700">
                          {inv.email} · <span className="capitalize">{inv.role}</span>
                        </span>
                        <form action={revokeInvite}>
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <button className="text-xs text-slate-500 hover:underline">Revoke</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-5 border-t border-slate-100 pt-5">
                <InviteForm />
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
